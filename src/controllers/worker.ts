import e, { type Request, type Response } from "express";
import prisma from "../../prisma/config.js";
import { suspendUser } from "./user.js";

export const getSiteDetails = async (req: Request, res: Response) => {
  const { foremanId, siteId } = req.body;

  try {
    if (!foremanId || !siteId) {
      res.status(200).json({
        status: "id_missing",
        message: "foremanId and siteId are required",
      });
      return;
    }

    const result = await prisma.$queryRaw<
      Array<{
        site_id: string;
        site_name: string;
        site_description: string | null;
        site_location: string;
        site_created_at: Date;
        singleWorkerPayments: string[];
        batchPayments: string[];
      }>
    >`
  SELECT 
    s.id::text as site_id,
    s.name as site_name,
    s.description as site_description,
    s.location as site_location,
    s."createdAt" as site_created_at,
    ARRAY_AGG(DISTINCT p.id::text) FILTER (WHERE p.batch_id IS NULL) as singleWorkerPayments,
    ARRAY_AGG(DISTINCT p.batch_id::text) FILTER (WHERE p.batch_id IS NOT NULL) as batchPayments
  FROM "Site" s
  LEFT JOIN "Payment" p 
    ON p."siteId"::text = s.id::text
    AND p.status = 'PENDING'::"PaymentStatus"
  WHERE s.id::text = ${siteId}
    AND s."foremanId"::text = ${foremanId}
    GROUP BY s.id, s.name, s.description, s.location, s."createdAt"
`;

    if (!result) {
      return res.status(200).json({
        message: "site details",
        success: false,
      });
    }

    return res.status(200).json({
      data: result[0],
      success: true,
      message: "Site details recieved",
    });
  } catch (error) {
    console.error("Error while getting site details:", error);
    res.status(500).json({
      status: "failed",
      message: "An error occurred while getting the site details",
    });
  }
};
