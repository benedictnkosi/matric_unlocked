import { NextResponse } from "next/server";
import { getTopicById, saveTopicPostedStatus } from "@/lib/topics";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      posted?: unknown;
      postedUrl?: unknown;
    };

    if (typeof body.posted !== "boolean") {
      return NextResponse.json({ error: "posted must be a boolean." }, { status: 400 });
    }

    const postedUrl =
      typeof body.postedUrl === "string" ? body.postedUrl.trim() : "";

    if (body.posted && !postedUrl) {
      return NextResponse.json(
        { error: "A URL is required when marking a topic as posted." },
        { status: 400 },
      );
    }

    if (postedUrl && !isValidUrl(postedUrl)) {
      return NextResponse.json(
        { error: "Please enter a valid http or https URL." },
        { status: 400 },
      );
    }

    const topic = await getTopicById(id);
    if (!topic) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    await saveTopicPostedStatus(id, body.posted, postedUrl);

    return NextResponse.json({
      success: true,
      posted: body.posted,
      postedUrl: body.posted ? postedUrl : "",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update posted status.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
