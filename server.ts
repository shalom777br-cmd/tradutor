import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Lazy initialize Gemini AI client
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes MUST be defined before Vite middleware
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({ error: "Text is required" });
      }

      const ai = getGeminiClient();
      
      // Try multiple models to ensure high availability and stability
      const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.5-flash"];
      let lastError: any = null;
      let translatedText = "";

      for (const model of modelsToTry) {
        let retries = 2;
        let success = false;

        while (retries >= 0) {
          try {
            console.log(`[Translation] Requesting translation with model: ${model}`);
            const response = await ai.models.generateContent({
              model: model,
              contents: text,
              config: {
                systemInstruction:
                  "You are a Japanese-to-Portuguese simultaneous interpreter. Translate the given Japanese phrase into spoken Brazilian Portuguese. The output must be natural, fluent, and conversational, exactly as a native Portuguese speaker would say it in an everyday conversation. Do NOT write any Japanese, translations of grammar, explanation, notes, or pronunciation guides. Write ONLY the Portuguese translation itself. Keep punctuation natural.",
              },
            });

            translatedText = response.text?.trim() || "";
            if (translatedText) {
              success = true;
              break;
            }
          } catch (error: any) {
            lastError = error;
            console.warn(`[Translation] Model ${model} failed (retries left: ${retries}):`, error.message || error);
            
            // If it is a 503, 429, or general high demand error, we can retry after a short delay
            const isTransient = 
              error.message?.includes("503") || 
              error.message?.includes("429") || 
              error.message?.includes("high demand") || 
              error.message?.includes("UNAVAILABLE") ||
              error.status === 503 || 
              error.status === 429;

            if (isTransient && retries > 0) {
              retries--;
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
            break; // Move to the next model
          }
        }

        if (success) {
          break;
        }
      }

      if (!translatedText) {
        throw lastError || new Error("All translation models were unavailable.");
      }

      res.json({ original: text, translation: translatedText });
    } catch (error: any) {
      console.error("Translation API error:", error);
      res.status(500).json({ error: error.message || "Failed to translate text" });
    }
  });

  // Serve static assets & handle routing via Vite or static dist folder
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
