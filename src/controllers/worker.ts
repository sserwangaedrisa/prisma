import e, { type Request, type Response } from "express";
import prisma from "../../prisma/config.js";

export const getSiteDetails = async (req: Request, res: Response) => {
  const { foremanId } = req.body;

  try {
    if (!foremanId) {
      res.status(200).json({
        status: "Id missing",
        massage: "Id missing, please sign in again and try again",
      });
      return;
    }
    const site = await prisma.site.findFirst({
      where: {
        foremanId,
      },
      include: {
        monthCloses: true,
        payments: true,
        foreman: true,
        workers: {
          include: {
            worker: {
              include: {
                activityLogs: true,
                payments: true,
                assignedSites: true,
                workerRecords: true,
              },
            },
          },
        },
        workEntries: true,
      },
    });

    if (!site) {
      res.status(200).json({
        status: "no_site_found",
        message: "No site found under Your Id, login again to proceed",
      });
      return;
    } else {
      res.status(200).json({
        status: "success",
        message: "site with its workers got successfully",
        site: site,
      });
    }
  } catch (error) {
    console.log("error while getting workers", error);
    res.status(500).json({
      status: "failed",
      massage: "An error occured while getting the workers.",
    });
  }
};
