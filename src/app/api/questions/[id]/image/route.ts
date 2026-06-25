import { NextResponse } from "next/server";
import {
  clearQuestionImagePath,
  getQuestionById,
  hasAssignedQuestionImage,
  isValidQuestionImageStoragePath,
  updateQuestionImagePath,
} from "@/lib/questions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { imagePath?: unknown };

    if (typeof body.imagePath !== "string" || !body.imagePath.trim()) {
      return NextResponse.json({ error: "imagePath must be a non-empty string." }, { status: 400 });
    }

    const imagePath = body.imagePath.trim();
    if (!isValidQuestionImageStoragePath(imagePath, id)) {
      return NextResponse.json(
        { error: "imagePath must be a Firebase Storage path for this question." },
        { status: 400 },
      );
    }

    const question = await getQuestionById(id);
    if (!question) {
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }

    await updateQuestionImagePath(id, imagePath);

    return NextResponse.json({
      success: true,
      imagePath,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update question image.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const question = await getQuestionById(id);
    if (!question) {
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }

    if (!hasAssignedQuestionImage(question.image_path)) {
      return NextResponse.json({ error: "Question has no image to remove." }, { status: 400 });
    }

    await clearQuestionImagePath(id);

    return NextResponse.json({
      success: true,
      imagePath: "",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove question image.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
