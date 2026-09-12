from pathlib import Path

path = Path('scripts/migrate-creative-mode-v020.py')
text = path.read_text()

old = """'''    const depthInstructions =
      depthStyle === \"work\" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;

    res.status(200);
''',
'''    const depthInstructions =
      depthStyle === \"work\" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const modeInstructions =
      productMode === \"creative\" ? CREATIVE_MODE_PROMPT : \"\";

    res.status(200);
''',"""
new = """'''    const depthInstructions =
      depthStyle === \"work\" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const input = [
''',
'''    const depthInstructions =
      depthStyle === \"work\" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const modeInstructions =
      productMode === \"creative\" ? CREATIVE_MODE_PROMPT : \"\";
    const input = [
''',"""

count = text.count(old)
if count != 1:
    raise RuntimeError(f'creative stream matcher block: expected 1 match, found {count}')
path.write_text(text.replace(old, new, 1))
print('Fixed Creative Mode stream matcher.')
