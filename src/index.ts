import "dotenv/config";
import { PrismaClient } from "../prisma/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import express, {
  type Application,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import morgan from "morgan";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import swaggerJsDocs from "swagger-jsdoc";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import userRoute from "./routes/user.js";
import workerRoute from "./routes/worker";
import attendanceRoute from "./routes/attendance";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

dotenv.config();

// Swagger components
import components from "./utils/swagger-components.js";

const app: Application = express();

app.set("trust proxy", 1);

const server = http.createServer(app);

const PORT = process.env.PORT || 8000;

// ===== Middleware =====
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));

// ===== Swagger Setup =====
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Gataama API",
      version: "1.0.0",
    },
    components,
  },
  apis: ["./src/routes/*.ts"], // pointing to TS routes
};
const swaggerDocs = swaggerJsDocs(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.use("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ message: "API is working" });
});

app.use(
  "/api/images",
  express.static(path.join(__dirname, "generated/generated/uploads/blog/")),
);

app.use("/users", userRoute);
app.use("/worker", workerRoute);
app.use("/attendance", attendanceRoute);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: "Not Found" });
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status || 500).json({
    message: error.message || "Internal Server Error",
    err: error.message || "Internal Server Error",
  });
});

(async () => {
  try {
    await prisma.$connect();
    console.log("✅ PostgreSQL connected successfully");

    server.listen(PORT, () => {
      console.log(
        `Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`,
      );
    });
  } catch (error) {
    console.error("❌ Failed to connect to PostgreSQL:", error);
  }
})();
