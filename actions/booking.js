"use server";

import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { StreamClient } from "@stream-io/node-sdk";
import { revalidatePath } from "next/cache";
import { request } from "@arcjet/next";
import { createRateLimiter, checkRateLimit } from "@/lib/arcjet";

// 5 booking attempts per hour — generous enough for real users,
// tight enough to block automated abuse
const bookingLimiter = createRateLimiter({
  refillRate: 2,
  interval: "1h",
  capacity: 5,
});

export const getInterviewerProfile = async (interviewerId) => {
  try {
    const interviewer = await db.user.findUnique({
      where: { id: interviewerId, role: "INTERVIEWER" },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        title: true,
        company: true,
        yearsExp: true,
        bio: true,
        categories: true,
        creditRate: true,
        availabilities: {
          where: { status: "AVAILABLE" },
          select: { startTime: true, endTime: true },
          take: 1,
        },
        bookingsAsInterviewer: {
          where: { status: "SCHEDULED" },
          select: { startTime: true, endTime: true },
        },
      },
    });

    return interviewer ?? null;
  } catch (err) {
    console.error("getInterviewerProfile error:", err);
    throw new Error("Failed to fetch interviewer profile");
  }
};

export const bookSlot = async ({ interviewerId, startTime, endTime }) => {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  // Rate limit
  const req = await request();
  const rateLimitError = await checkRateLimit(bookingLimiter, req, user.id);
  if (rateLimitError) throw new Error(rateLimitError);

  const [dbUser, interviewer] = await Promise.all([
    db.user.findUnique({ where: { clerkUserId: user.id } }),
    db.user.findUnique({ where: { id: interviewerId } }),
  ]);

  if (!dbUser || dbUser.role !== "INTERVIEWEE")
    throw new Error("Only interviewees can book sessions");

  if (!interviewer || interviewer.role !== "INTERVIEWER")
    throw new Error("Interviewer not found");

  const credits = interviewer.creditRate ?? 10;

  let booking;

  try {
    booking = await db.$transaction(
      async (tx) => {
        // Always re-check credits inside the transaction
        const freshUser = await tx.user.findUnique({
          where: { id: dbUser.id },
          select: { credits: true },
        });

        if (!freshUser || freshUser.credits < credits) {
          throw new Error("Insufficient credits. Please upgrade your plan.");
        }

        // await new Promise((resolve) => setTimeout(resolve, 7000));
        
        const newBooking = await tx.booking.create({
          data: {
            intervieweeId: dbUser.id,
            interviewerId,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            status: "SCHEDULED",
            creditsCharged: credits,
            streamCallId: null,
          },
        });

        await tx.creditTransaction.create({
          data: {
            userId: dbUser.id,
            amount: -credits,
            type: "BOOKING_DEDUCTION",
            bookingId: newBooking.id,
          },
        });

        await tx.user.update({
          where: { id: dbUser.id },
          data: {
            credits: {
              decrement: credits,
            },
          },
        });

        await tx.user.update({
          where: { id: interviewerId },
          data: {
            creditBalance: {
              increment: credits,
            },
          },
        });

        return newBooking;
      },
      {
        isolationLevel: "Serializable",
      },
    );
  } catch (err) {
    console.error("Booking transaction failed:", err);

    const code = err?.cause?.originalCode || err?.cause?.code || err?.code;

    if (code === "23P01") {
      throw new Error("This slot was just booked. Please pick another.");
    }

    throw new Error(err.message || "Booking failed. Please try again.");
  }

  // Create Stream call AFTER booking succeeds
  let streamCallId;

  try {
    const streamClient = new StreamClient(
      process.env.NEXT_PUBLIC_STREAM_API_KEY,
      process.env.STREAM_SECRET_KEY,
    );

    await streamClient.upsertUsers([
      {
        id: dbUser.clerkUserId,
        name: dbUser.name ?? "Interviewee",
        image: dbUser.imageUrl ?? undefined,
        role: "user",
      },
      {
        id: interviewer.clerkUserId,
        name: interviewer.name ?? "Interviewer",
        image: interviewer.imageUrl ?? undefined,
        role: "user",
      },
    ]);

    streamCallId = `mock_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const call = streamClient.video.call("default", streamCallId);

    await call.getOrCreate({
      data: {
        created_by_id: dbUser.clerkUserId,
        members: [
          {
            user_id: dbUser.clerkUserId,
            role: "host",
          },
          {
            user_id: interviewer.clerkUserId,
            role: "host",
          },
        ],
        settings_override: {
          recording: {
            mode: "available",
            quality: "1080p",
          },
          screensharing: {
            enabled: true,
          },
          transcription: {
            mode: "auto-on",
          },
        },
      },
    });

    await db.booking.update({
      where: {
        id: booking.id,
      },
      data: {
        streamCallId,
      },
    });
  } catch (err) {
    console.error("Stream call creation failed:", err);

    try {
      await db.$transaction(async (tx) => {
        await tx.creditTransaction.deleteMany({
          where: {
            bookingId: booking.id,
          },
        });

        await tx.user.update({
          where: {
            id: dbUser.id,
          },
          data: {
            credits: {
              increment: credits,
            },
          },
        });

        await tx.user.update({
          where: {
            id: interviewerId,
          },
          data: {
            creditBalance: {
              decrement: credits,
            },
          },
        });

        await tx.booking.delete({
          where: {
            id: booking.id,
          },
        });
      });
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }

    throw new Error(
      "Unable to create the interview room. Please try booking again.",
    );
  }

  revalidatePath(`/interviewers/${interviewerId}`);
  revalidatePath("/dashboard");

  return {
    success: true,
    bookingId: booking.id,
    streamCallId,
  };
};

/* What's happening now
✅ Authentication
Ensures the user is logged in.
✅ Rate limiting
Prevents users from spamming booking requests.
✅ User validation
Confirms the requester is an interviewee.
Confirms the selected interviewer exists.
✅ Database transaction
Re-checks the interviewee's credits.
Creates the booking.
Deducts interviewee credits.
Credits the interviewer.
All of these succeed or fail together.
✅ Database-level overlap protection
Your PostgreSQL exclusion constraint guarantees that two overlapping SCHEDULED bookings for the same interviewer cannot exist.
If two users click at the same time:
One succeeds.

The other gets a database error (23P01), which you convert into:

"This slot was just booked. Please pick another."

✅ Video room creation
Happens only after the booking is successfully committed.
No more orphan Stream rooms from failed bookings.
✅ Booking update
Stores the generated streamCallId.
✅ Rollback if Stream fails
Deletes the booking.
Refunds interviewee credits.
Removes interviewer credit.
Deletes the credit transaction.
Leaves the database consistent.
✅ Cache revalidation
Refreshes the interviewer page and dashboard so users see the latest availability. */