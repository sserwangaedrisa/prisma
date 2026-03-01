import { type Response } from "express";

export default function handleError(error: unknown, res: Response) {
    console.log(error)
    if (process.env.NODE_ENV === "development") {
        console.error("Error:", error instanceof Error ? error.message : error);
     
    }

    res.status(500).json({
        message: "Internal server error",
        error: process.env.NODE_ENV === "development" && error instanceof Error 
            ? error.message 
            : undefined
    });
}
