import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODEL_CONFIG_PATH = path.resolve(__dirname, "public/model/config.json");

const configApiPlugin = () => ({
  name: "model-config-api",
  configureServer(server: any) {
    server.middlewares.use("/api/config", (req: any, res: any, next: any) => {
      if (!MODEL_CONFIG_PATH.startsWith(__dirname)) {
        res.statusCode = 403;
        res.end("Invalid config path");
        return;
      }

      if (req.method === "GET") {
        fs.readFile(MODEL_CONFIG_PATH, "utf8", (err, data) => {
          if (err) {
            res.statusCode = 500;
            res.end("Không đọc được config.json");
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(data || "{}");
        });
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 2 * 1024 * 1024) {
            res.statusCode = 413;
            res.end("Payload too large");
            req.destroy();
          }
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body || "{}");
            const content = JSON.stringify(parsed, null, 2);
            fs.writeFile(MODEL_CONFIG_PATH, content, "utf8", (err) => {
              if (err) {
                res.statusCode = 500;
                res.end("Không ghi được config.json");
                return;
              }
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(content);
            });
          } catch (err) {
            res.statusCode = 400;
            res.end("JSON không hợp lệ");
          }
        });
        return;
      }

      next();
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), configApiPlugin()],
})
