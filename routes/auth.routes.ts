import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { db } from "../index";

const router = Router();
dotenv.config();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await db.user.findUnique({
      where: { user_name: username, user_password: password },
      select: { user_name: true }
    });

    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const payload = { username: username };
    if (!process.env.JWT_SECRET) {
      res.status(500).json({ message: "JWT secret is not defined" });
    }
    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: "1d" });

    res.json({ message: "Login successful", token });
  } catch (err: any) {
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

router.post("/register", async (req: Request, res: Response) => {
  const { username, password, balance = 0 } = req.body;

  try {
    const existingUser = await db.user.findUnique({
      where: { user_name: username }
    });

    if (existingUser) {
      res.status(400).json({ message: "Username already exists" });
    }

    const newUser = await db.user.create({
      data: {
        user_name: username,
        user_password: password,
        user_balance: balance
      }
    });

    if (!process.env.JWT_SECRET) {
      res.status(500).json({ message: "JWT secret is not defined" });
    }

    const payload = { username: username };
    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: "1d" });

    res.status(201).json({ message: "User registered successfully", token });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Database error" });
  }
});

export const requireAdmin = async (req: Request): Promise<boolean> => {
  try {
    const user = req.user as { username?: string };
    if (!user || !user.username) {
      return false;
    }

    const foundUser = await db.user.findUnique({
      where: { user_name: user.username },
      select: { user_role: true }
    });

    if (!foundUser) {
      return false;
    }

    return foundUser.user_role === "ADMIN";
  } catch {
    return false;
  }
};

export default router;