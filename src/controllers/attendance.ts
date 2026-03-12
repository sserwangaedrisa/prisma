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
        hours,
        notes,
        overtime,
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
