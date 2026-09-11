const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/chat", async (req, res) => {
  try {
      const message = req.body.message;

          if (!message || !message.trim()) {
                return res.status(400).json({
                        error: "Please enter a message."
                              });
                                  }

                                      if (!process.env.OPENAI_API_KEY) {
                                            return res.status(500).json({
                                                    error: "OPENAI_API_KEY is not loaded."
                                                          });
                                                              }

                                                                  const OpenAI = (await import("openai")).default;

                                                                      const client = new OpenAI({
                                                                            apiKey: process.env.OPENAI_API_KEY
                                                                                });

                                                                                    const response = await client.responses.create({
                                                                                          model: "gpt-5.6-luna",
                                                                                                input: message
                                                                                                    });

                                                                                                        res.json({
                                                                                                              reply: response.output_text
                                                                                                                  });

                                                                                                                    } catch (error) {
                                                                                                                        console.error("UNBOUND AI ERROR:", error);

                                                                                                                            res.status(500).json({
                                                                                                                                  error: error.message || "UNBOUND AI could not get a response."
                                                                                                                                      });
                                                                                                                                        }
                                                                                                                                        });

                                                                                                                                        app.get("/", (req, res) => {
                                                                                                                                          res.sendFile(path.join(__dirname, "index.html"));
                                                                                                                                          });

                                                                                                                                          app.listen(PORT, "0.0.0.0", () => {
                                                                                                                                            console.log(`UNBOUND AI running on port ${PORT}`);
                                                                                                                                            });
                                                                                                                                            