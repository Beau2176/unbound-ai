(() => {
  "use strict";

  const MAX_VIDEO_MS = 60_000;
  const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
  let activeStream = null;
  let recorder = null;
  let recordTimer = null;

  function injectStyles() {
    if (document.getElementById("unbound-media-capture-style")) return;
    const style = document.createElement("style");
    style.id = "unbound-media-capture-style";
    style.textContent = `
      .unbound-media-actions{display:flex;gap:6px;align-items:center;flex:0 0 auto}
      .unbound-media-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:42px;min-height:42px;padding:0 9px;border:1px solid rgba(107,193,255,.32);border-radius:12px;background:rgba(8,20,35,.82);color:#dff4ff;font:800 11px/1 system-ui;cursor:pointer}
      .unbound-media-button:hover{border-color:rgba(107,193,255,.7);background:rgba(21,49,77,.9)}
      .unbound-media-button svg{width:18px;height:18px;fill:currentColor}
      .unbound-media-modal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.76);backdrop-filter:blur(6px)}
      .unbound-media-panel{width:min(720px,100%);max-height:92vh;overflow:auto;border:1px solid rgba(107,193,255,.35);border-radius:18px;background:#07111e;color:#eef8ff;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:14px}
      .unbound-media-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
      .unbound-media-head strong{font-size:15px;letter-spacing:.03em}
      .unbound-media-close{border:0;background:transparent;color:#dcecff;font-size:25px;cursor:pointer;line-height:1}
      .unbound-media-preview{display:block;width:100%;max-height:55vh;object-fit:contain;border-radius:14px;background:#000}
      .unbound-media-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
      .unbound-media-primary,.unbound-media-secondary{min-height:42px;padding:0 14px;border-radius:11px;font-weight:900;cursor:pointer}
      .unbound-media-primary{border:1px solid rgba(79,188,255,.7);background:#176f9e;color:white}
      .unbound-media-secondary{border:1px solid rgba(255,255,255,.2);background:#101e2d;color:#e9f5ff}
      .unbound-media-danger{border-color:rgba(255,103,103,.55);background:rgba(120,26,26,.55)}
      .unbound-media-prompt{width:100%;min-height:76px;box-sizing:border-box;margin-top:10px;padding:10px;border:1px solid rgba(107,193,255,.25);border-radius:10px;background:#020812;color:#eef8ff;resize:vertical}
      .unbound-media-note{margin-top:9px;color:#9fb4ca;font-size:11px;line-height:1.45}
      .unbound-media-status{margin-top:9px;color:#8ee7b2;font-size:12px;white-space:pre-wrap}
      .unbound-media-result-image{display:block;max-width:min(480px,100%);margin-top:10px;border-radius:12px}
      @media(max-width:700px){.unbound-media-button{min-width:38px;min-height:38px;padding:0 7px}.unbound-media-button span{display:none}.unbound-media-actions{gap:4px}.unbound-media-panel{padding:11px}.unbound-media-modal{align-items:flex-end;padding:8px}.unbound-media-panel{border-radius:18px 18px 10px 10px;max-height:95vh}}
    `;
    document.head.appendChild(style);
  }

  function icon(type) {
    if (type === "photo") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-3.2L15 3H9Zm3 4.2A5.8 5.8 0 1 1 12 18.8 5.8 5.8 0 0 1 12 7.2Zm0 2A3.8 3.8 0 1 0 12 16.8 3.8 3.8 0 0 0 12 9.2Z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10a3 3 0 0 1 3 3v1.2l4.4-2.7A1 1 0 0 1 23 7.4v9.2a1 1 0 0 1-1.6.9L17 14.8V16a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/></svg>';
  }

  function appendChatMessage(role, text, imageDataUrl = null) {
    const messages = document.getElementById("messages");
    if (!messages) return;
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    const textNode = document.createElement("div");
    textNode.style.whiteSpace = "pre-wrap";
    textNode.textContent = String(text || "");
    bubble.appendChild(textNode);
    if (imageDataUrl) {
      const img = document.createElement("img");
      img.className = "unbound-media-result-image";
      img.alt = role === "assistant" ? "UNBOUND AI image result" : "Captured photo";
      img.src = imageDataUrl;
      bubble.appendChild(img);
    }
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  function stopStream() {
    if (recordTimer) clearTimeout(recordTimer);
    recordTimer = null;
    if (activeStream) {
      for (const track of activeStream.getTracks()) track.stop();
    }
    activeStream = null;
    recorder = null;
  }

  function closeModal(modal) {
    stopStream();
    if (modal?.parentNode) modal.parentNode.removeChild(modal);
  }

  function makeModal(title) {
    const modal = document.createElement("div");
    modal.className = "unbound-media-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const panel = document.createElement("div");
    panel.className = "unbound-media-panel";
    const head = document.createElement("div");
    head.className = "unbound-media-head";
    head.innerHTML = `<strong>${title}</strong>`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "unbound-media-close";
    close.setAttribute("aria-label", "Close camera");
    close.textContent = "×";
    close.onclick = () => closeModal(modal);
    head.appendChild(close);
    panel.appendChild(head);
    modal.appendChild(panel);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
    document.body.appendChild(modal);
    return { modal, panel };
  }

  function dataUrlParts(dataUrl) {
    const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) throw new Error("Could not prepare the captured image.");
    const ext = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
    return { mimeType: match[1], base64: match[2], ext };
  }

  async function readError(response) {
    try {
      const data = await response.json();
      return data.error || data.message || `Request failed (${response.status}).`;
    } catch (_) {
      return `Request failed (${response.status}).`;
    }
  }

  async function analyzeImage(dataUrl, prompt, filenameBase = "camera") {
    const parts = dataUrlParts(dataUrl);
    const response = await fetch("/api/image-understanding", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        filename: `${filenameBase}.${parts.ext}`,
        imageBase64: parts.base64,
        prompt: String(prompt || "").trim() || "Analyze this captured image and give me useful, practical information about what is visible.",
        detail: "auto"
      })
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  }

  async function editImage(dataUrl, prompt, filenameBase = "camera") {
    const parts = dataUrlParts(dataUrl);
    const response = await fetch("/api/image-tools/edit", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        filename: `${filenameBase}.${parts.ext}`,
        imageBase64: parts.base64,
        prompt: String(prompt || "").trim(),
        inputFidelity: "high",
        size: "auto",
        quality: "medium",
        background: "auto",
        outputFormat: "png"
      })
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json();
  }

  function photoReview(modal, panel, dataUrl) {
    stopStream();
    panel.querySelector(".unbound-media-head strong").textContent = "Use captured photo";
    const oldPreview = panel.querySelector(".unbound-media-preview");
    if (oldPreview) oldPreview.remove();
    const oldControls = panel.querySelector(".unbound-media-controls");
    if (oldControls) oldControls.remove();

    const img = document.createElement("img");
    img.className = "unbound-media-preview";
    img.src = dataUrl;
    img.alt = "Captured photo preview";
    panel.appendChild(img);

    const prompt = document.createElement("textarea");
    prompt.className = "unbound-media-prompt";
    prompt.placeholder = "Ask about this photo, or describe the edit you want…";
    panel.appendChild(prompt);

    const status = document.createElement("div");
    status.className = "unbound-media-status";
    panel.appendChild(status);

    const controls = document.createElement("div");
    controls.className = "unbound-media-controls";
    const analyze = document.createElement("button");
    analyze.type = "button";
    analyze.className = "unbound-media-primary";
    analyze.textContent = "Analyze photo";
    analyze.onclick = async () => {
      analyze.disabled = true;
      status.textContent = "Analyzing photo…";
      try {
        appendChatMessage("user", prompt.value.trim() || "Analyze this captured photo.", dataUrl);
        const result = await analyzeImage(dataUrl, prompt.value, `camera-${Date.now()}`);
        appendChatMessage("assistant", result.analysis || "Image analysis completed.");
        closeModal(modal);
      } catch (error) {
        status.textContent = error.message || "Could not analyze the photo.";
        analyze.disabled = false;
      }
    };

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "unbound-media-secondary";
    edit.textContent = "Edit photo";
    edit.onclick = async () => {
      if (!prompt.value.trim()) {
        status.textContent = "Describe the edit you want first.";
        prompt.focus();
        return;
      }
      edit.disabled = true;
      status.textContent = "Editing photo…";
      try {
        appendChatMessage("user", `Edit captured photo: ${prompt.value.trim()}`, dataUrl);
        const result = await editImage(dataUrl, prompt.value, `camera-${Date.now()}`);
        const outputFormat = String(result.outputFormat || "png").toLowerCase();
        const mime = outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png";
        const resultUrl = `data:${mime};base64,${result.imageBase64}`;
        appendChatMessage("assistant", "Photo edit completed.", resultUrl);
        closeModal(modal);
      } catch (error) {
        status.textContent = error.message || "Could not edit the photo.";
        edit.disabled = false;
      }
    };

    const retake = document.createElement("button");
    retake.type = "button";
    retake.className = "unbound-media-secondary";
    retake.textContent = "Retake";
    retake.onclick = () => {
      closeModal(modal);
      openPhotoCamera();
    };

    controls.append(analyze, edit, retake);
    panel.appendChild(controls);
    const note = document.createElement("div");
    note.className = "unbound-media-note";
    note.textContent = "Photo analysis is available from Premium. AI photo editing is an Ultra feature. The raw captured photo is sent only when you choose Analyze or Edit and is not stored by UNBOUND's image endpoints.";
    panel.appendChild(note);
  }

  function fallbackPhotoPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.setAttribute("capture", "environment");
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        appendChatMessage("assistant", "That photo is too large. Choose or capture an image 8 MB or smaller.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const { modal, panel } = makeModal("Use captured photo");
        photoReview(modal, panel, String(reader.result || ""));
      };
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
  }

  async function openPhotoCamera() {
    injectStyles();
    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackPhotoPicker();
      return;
    }
    const { modal, panel } = makeModal("Take a photo");
    const video = document.createElement("video");
    video.className = "unbound-media-preview";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    panel.appendChild(video);
    const status = document.createElement("div");
    status.className = "unbound-media-status";
    panel.appendChild(status);
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      video.srcObject = activeStream;
      await video.play().catch(() => {});
    } catch (_) {
      closeModal(modal);
      fallbackPhotoPicker();
      return;
    }

    const controls = document.createElement("div");
    controls.className = "unbound-media-controls";
    const capture = document.createElement("button");
    capture.type = "button";
    capture.className = "unbound-media-primary";
    capture.textContent = "Take photo";
    capture.onclick = () => {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const scale = Math.min(1, 1920 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      photoReview(modal, panel, dataUrl);
    };
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "unbound-media-secondary";
    choose.textContent = "Choose existing photo";
    choose.onclick = () => {
      closeModal(modal);
      fallbackPhotoPicker();
    };
    controls.append(capture, choose);
    panel.appendChild(controls);
  }

  function seekVideo(video, time) {
    return new Promise((resolve) => {
      const onSeeked = () => resolve();
      video.addEventListener("seeked", onSeeked, { once: true });
      video.currentTime = Math.max(0, Math.min(time, Math.max(0, (video.duration || 0) - 0.05)));
    });
  }

  async function extractVideoFrames(blob, count = 3) {
    const url = URL.createObjectURL(blob);
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("Could not read the recorded video."));
      });
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const fractions = count === 1 ? [0.5] : [0.15, 0.5, 0.85].slice(0, count);
      const frames = [];
      for (let index = 0; index < fractions.length; index += 1) {
        await seekVideo(video, duration * fractions[index]);
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const scale = Math.min(1, 1600 / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.82));
      }
      return frames;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function analyzeRecordedVideo(blob, prompt, status) {
    status.textContent = "Extracting representative video frames…";
    const frames = await extractVideoFrames(blob, 3);
    const analyses = [];
    for (let i = 0; i < frames.length; i += 1) {
      status.textContent = `Analyzing video frame ${i + 1} of ${frames.length}…`;
      const instruction = [
        String(prompt || "").trim() || "Explain what is visible in this recorded video.",
        `This is representative frame ${i + 1} of ${frames.length} from the same video. Describe useful visible details and do not infer audio or unseen motion.`
      ].join("\n\n");
      const result = await analyzeImage(frames[i], instruction, `video-frame-${Date.now()}-${i + 1}`);
      analyses.push(`Frame ${i + 1}:\n${result.analysis || "No analysis returned."}`);
    }
    return analyses.join("\n\n");
  }

  function videoReview(modal, panel, blob) {
    stopStream();
    panel.querySelector(".unbound-media-head strong").textContent = "Use recorded video";
    panel.querySelectorAll(".unbound-media-preview,.unbound-media-controls,.unbound-media-note,.unbound-media-status").forEach((node) => node.remove());

    const previewUrl = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.className = "unbound-media-preview";
    video.controls = true;
    video.playsInline = true;
    video.src = previewUrl;
    panel.appendChild(video);

    const prompt = document.createElement("textarea");
    prompt.className = "unbound-media-prompt";
    prompt.placeholder = "What should UNBOUND look for in this video?";
    panel.appendChild(prompt);
    const status = document.createElement("div");
    status.className = "unbound-media-status";
    panel.appendChild(status);
    const controls = document.createElement("div");
    controls.className = "unbound-media-controls";

    const analyze = document.createElement("button");
    analyze.type = "button";
    analyze.className = "unbound-media-primary";
    analyze.textContent = "Analyze video visuals";
    analyze.onclick = async () => {
      analyze.disabled = true;
      try {
        appendChatMessage("user", prompt.value.trim() || "Analyze the important visible content in this recorded video.");
        const result = await analyzeRecordedVideo(blob, prompt.value, status);
        appendChatMessage("assistant", `Video visual scan (representative frames):\n\n${result}`);
        URL.revokeObjectURL(previewUrl);
        closeModal(modal);
      } catch (error) {
        status.textContent = error.message || "Could not analyze the video frames.";
        analyze.disabled = false;
      }
    };

    const retake = document.createElement("button");
    retake.type = "button";
    retake.className = "unbound-media-secondary";
    retake.textContent = "Record again";
    retake.onclick = () => {
      URL.revokeObjectURL(previewUrl);
      closeModal(modal);
      openVideoRecorder();
    };
    controls.append(analyze, retake);
    panel.appendChild(controls);

    const note = document.createElement("div");
    note.className = "unbound-media-note";
    note.textContent = "Current video support records locally in your browser and analyzes representative visual frames through Premium image understanding. The raw video file is not uploaded. Full motion/audio video understanding and AI video editing are not active yet.";
    panel.appendChild(note);
  }

  async function openVideoRecorder() {
    injectStyles();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      appendChatMessage("assistant", "Video recording is not supported by this browser or device yet. Try the current Chrome/Android app build or a modern desktop browser.");
      return;
    }
    const { modal, panel } = makeModal("Record video");
    const video = document.createElement("video");
    video.className = "unbound-media-preview";
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    panel.appendChild(video);
    const status = document.createElement("div");
    status.className = "unbound-media-status";
    status.textContent = "Camera ready.";
    panel.appendChild(status);

    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true
      });
      video.srcObject = activeStream;
      await video.play().catch(() => {});
    } catch (_) {
      closeModal(modal);
      appendChatMessage("assistant", "UNBOUND could not access the camera/microphone. Check camera and microphone permission for this site/app and try again.");
      return;
    }

    const controls = document.createElement("div");
    controls.className = "unbound-media-controls";
    const record = document.createElement("button");
    record.type = "button";
    record.className = "unbound-media-primary";
    record.textContent = "Start recording";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "unbound-media-secondary unbound-media-danger";
    stop.textContent = "Stop";
    stop.disabled = true;
    controls.append(record, stop);
    panel.appendChild(controls);

    const chunks = [];
    record.onclick = () => {
      chunks.length = 0;
      let mimeType = "";
      for (const candidate of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
        if (MediaRecorder.isTypeSupported(candidate)) { mimeType = candidate; break; }
      }
      try {
        recorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream);
      } catch (_) {
        status.textContent = "This device could not start video recording.";
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || "video/webm" });
        if (!blob.size) {
          status.textContent = "No video was captured.";
          return;
        }
        if (blob.size > MAX_VIDEO_BYTES) {
          status.textContent = "That recording is too large. Record a shorter clip.";
          return;
        }
        videoReview(modal, panel, blob);
      };
      recorder.start(500);
      record.disabled = true;
      stop.disabled = false;
      status.textContent = "Recording… maximum 60 seconds.";
      recordTimer = setTimeout(() => {
        if (recorder?.state === "recording") recorder.stop();
      }, MAX_VIDEO_MS);
    };
    stop.onclick = () => {
      if (recorder?.state === "recording") recorder.stop();
    };
  }

  function installButtons() {
    const form = document.getElementById("chatForm");
    const textarea = document.getElementById("message");
    if (!form || !textarea || document.getElementById("unboundMediaActions")) return;
    const actions = document.createElement("div");
    actions.id = "unboundMediaActions";
    actions.className = "unbound-media-actions";

    const photo = document.createElement("button");
    photo.type = "button";
    photo.className = "unbound-media-button";
    photo.id = "unboundPhotoButton";
    photo.title = "Take or choose a photo";
    photo.setAttribute("aria-label", "Take or choose a photo");
    photo.innerHTML = `${icon("photo")}<span>PHOTO</span>`;
    photo.onclick = openPhotoCamera;

    const video = document.createElement("button");
    video.type = "button";
    video.className = "unbound-media-button";
    video.id = "unboundVideoButton";
    video.title = "Record video";
    video.setAttribute("aria-label", "Record video");
    video.innerHTML = `${icon("video")}<span>VIDEO</span>`;
    video.onclick = openVideoRecorder;

    actions.append(photo, video);
    form.insertBefore(actions, textarea);
  }

  function initialize() {
    injectStyles();
    installButtons();
    const observer = new MutationObserver(installButtons);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
