import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import passport from "./auth/passport";
import userRoutes from "./routes/user.routes";
import authRoutes from "./routes/auth.routes";
import proposalsRoutes from "./routes/proposals.routes";
import betsRoutes from "./routes/bets.routes";
import mysql from "mysql2/promise";
import { checkMatchStatus } from "./riot_watcher/riot_watcher";

import { Request, Response } from "express";

dotenv.config();

export const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true}));
app.use(passport.initialize());

app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/proposals", proposalsRoutes);
app.use("/api/bets", betsRoutes);

app.get("/", (req: Request, res: Response) => {
  res.send("Bienvenue sur l'API !");
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
    db.getConnection().then(() => {
        console.log("Connexion à la base de données réussie !");
    })
    .catch((err) => {
        console.error("Erreur de connexion à la base de données :", err);
    });
});
