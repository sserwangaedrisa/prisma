import e, { type Request, type Response } from "express";
import prisma from "../../prisma/config.js";

export const recordAttendance = async (req: Request, res: Response) => {
  const { workerId, siteId, date, hours, notes, overtime } = req.body;
  try {
    if (!workerId || !siteId || !date || !hours) {
      res.status(200).json({
        status: "missing_fields",
        message: "Worker ID, Site ID, Date, and Hours are required.",
      });
      return;
    }
    // checking for user existence
    const worker = await prisma.user.findUnique({
      where: { id: workerId },
    });
    if (!worker) {
      res.status(200).json({
        status: "worker_not_found",
        message: "Worker not found.",
      });
      return;
    }

    // checking for site existence and if the worker is belonging to the site
    const site = await prisma.site.findFirst({
      where: { id: siteId },
      include: {
        workers: {
          where: { workerId },
        },
      },
    });

    if (!site) {
      res.status(200).json({
        status: "site_not_found",
        message: "Site not found.",
      });
      return;
    }

    if (site.workers.length === 0) {
      res.status(200).json({
        status: "not_assigned_to_site",
        message: "Worker is not assigned to the specified site.",
      });
      return;
    }

    const workEntry = await prisma.workEntry.create({
      data: {
        workerId,
        siteId,
        date,
        hours: parseInt(hours, 10),
        notes,
        overtime: overtime ? parseInt(overtime, 10) : 0,
      },
    });

    res.status(200).json({
      status: "success",
      message: "Attendance recorded successfully.",
    });
  } catch (error) {
    console.log("error while recording attendance", error);
    res.status(500).json({
      status: "failed",
      massage: "An error occured while recording attendance.",
    });
  }
};

export const todayAttendace = async (req: Request, res: Response) => {
  const { siteId } = req.body;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const presentWorkers = await prisma.workEntry.findMany({
      where: {
        siteId: siteId,
        date: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      select: {
        workerId: true,
      },
      distinct: ["workerId"],
    });

    if (!presentWorkers) {
      res.status(200).json({
        status: "no attandace record found",
        message: "no attendace  record found ",
      });
      return;
    }

    const todayWorkers = presentWorkers.map((w) => w.workerId);

    res.status(200).json({
      message: "attandance list for today retrieved successfully",
      status: "success",
      presentWorkers: todayWorkers,
    });
  } catch (error) {
    console.log("error while getting daily attendance: ", error);
    res
      .status(500)
      .json({ message: " internal server error ", status: "error" });
  }
};
