const OPENAI_API_BASE = "https://api.openai.com/v1";

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return apiKey;
}

function formatOpenAiError(operation: string, status: number, errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { message?: string };
    };
    const message = parsed.error?.message;
    if (message) {
      return `OpenAI ${operation} failed (${status}): ${message}`;
    }
  } catch {
    // Fall through.
  }

  return `OpenAI ${operation} failed (${status}): ${errorBody}`;
}

export async function uploadPdfToOpenAi(
  pdfBuffer: Buffer,
  filename: string,
): Promise<string> {
  const apiKey = getOpenAiApiKey();
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
    filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
  );
  formData.append("purpose", "user_data");

  const response = await fetch(`${OPENAI_API_BASE}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(formatOpenAiError("file upload", response.status, errorBody));
  }

  const payload = (await response.json()) as { id?: string };
  if (!payload.id?.trim()) {
    throw new Error("OpenAI file upload did not return a file id.");
  }

  return payload.id;
}

export async function validateOpenAiPdfFile(
  openAiFileId: string,
  options?: { model?: string },
): Promise<void> {
  const apiKey = getOpenAiApiKey();
  const model = options?.model ?? process.env.OPENAI_MODEL ?? "gpt-4o";

  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                file_id: openAiFileId,
              },
            },
            {
              type: "text",
              text: 'Confirm you can read this PDF. Return JSON: {"ok": true}',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(formatOpenAiError("PDF validation", response.status, errorBody));
  }

  const data = (await response.json()) as {
    choices: Array<{ message?: { content?: string } }>;
  };

  if (!data.choices[0]?.message?.content?.trim()) {
    throw new Error("OpenAI PDF validation returned an empty response.");
  }
}

export async function uploadImageToOpenAi(
  imageBuffer: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const apiKey = getOpenAiApiKey();
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(imageBuffer)], { type: contentType }),
    filename,
  );
  formData.append("purpose", "user_data");

  const response = await fetch(`${OPENAI_API_BASE}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(formatOpenAiError("image file upload", response.status, errorBody));
  }

  const payload = (await response.json()) as { id?: string };
  if (!payload.id?.trim()) {
    throw new Error("OpenAI image upload did not return a file id.");
  }

  return payload.id;
}
