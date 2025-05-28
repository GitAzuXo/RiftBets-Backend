import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import passport from "./auth/passport";
import userRoutes from "./routes/user.routes";
import authRoutes from "./routes/auth.routes";
import proposalsRoutes from "./routes/game.routes";
import betRoutes from "./routes/bet.routes";
import codeRoutes from "./routes/codes.routes";
import riotRoutes from "./routes/riot.routes";
import betOptionRoutes from "./routes/betoption.routes";
import { PrismaClient } from "@prisma/client";
import { autoCreateProposals } from "./routes/riot.routes";
import { autoFinishProposals } from "./riot_watcher/riot_watcher";
import { Request, Response } from "express";

dotenv.config();
export const db = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true}));
app.use(passport.initialize());

app.use("/api/user", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/game", proposalsRoutes);
app.use("/api/bet", betRoutes);
app.use("/api/betoption", betOptionRoutes);
//app.use("/api/codes", codeRoutes);
app.use("/api/riot", riotRoutes);

app.get("/", (req: Request, res: Response) => {
  res.send("Bienvenue sur l'API !");
});

app.listen(PORT, async () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
    try {
        await db.$connect();
        console.log("Connexion à la base de données Prisma réussie !");
    } catch (err) {
        console.error("Erreur de connexion à la base de données Prisma :", err);
    }
});

setInterval(async () => {
    try {
        await autoCreateProposals();
        console.log("Checked for soloq matches.");
    } catch (err) {
        console.error("Error in autoCreateProposals:", err);
    }
}, 24 * 1000);

setInterval(async () => {
    try {
        await autoFinishProposals();
        console.log("Checked for soloq finished.");
    } catch (err) {
        console.error("Error in autoFinishProposals:", err);
    }
}, 45 * 1000);