import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import OpenAI from "openai";

const LINQ_API_TOKEN = process.env.LINQ_API_TOKEN!;
const LINQ_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const LINQ_PHONE_NUMBER = process.env.LINQ_PHONE_NUMBER!;
const WEBHOOK_SIGNING_SECRET = process.env.WEBHOOK_SIGNING_SECRET || "";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function verifySignature(
  rawBody: string,
  sigHeader: string,
  tsHeader: string
): boolean {
  if (!WEBHOOK_SIGNING_SECRET) return true; // skip if not configured yet

  const ageMs = Date.now() - Number(tsHeader) * 1000;
  if (Math.abs(ageMs) > 5 * 60 * 1000) return false;

  const signedPayload = `${tsHeader}.${rawBody}`;
  const expected = createHmac("sha256", WEBHOOK_SIGNING_SECRET)
    .update(signedPayload)
    .digest("hex");
  const provided = sigHeader.startsWith("sha256=")
    ? sigHeader.slice(7)
    : sigHeader;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function generateAIResponse(userMessage: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a friendly AI assistant responding via iMessage. Keep responses concise and conversational (1-3 sentences max).",
      },
      { role: "user", content: userMessage },
    ],
    max_tokens: 150,
  });

  return completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
}

async function sendLinqMessage(chatId: string, text: string) {
  const response = await fetch(`${LINQ_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINQ_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      message: {
        parts: [{ type: "text", value: text }],
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to send Linq message:", response.status, errorText);
    throw new Error(`Linq API error: ${response.status}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Verify webhook signature
  const sigHeader = request.headers.get("x-webhook-signature") || "";
  const tsHeader = request.headers.get("x-webhook-timestamp") || "";

  if (WEBHOOK_SIGNING_SECRET && !verifySignature(rawBody, sigHeader, tsHeader)) {
    console.error("Webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  console.log("Webhook received:", JSON.stringify(payload, null, 2));

  // Only respond to incoming messages
  if (payload.event_type !== "message.received") {
    return NextResponse.json({ ok: true });
  }

  const { data } = payload;

  // Skip messages from ourselves
  if (data.sender_handle?.is_me) {
    return NextResponse.json({ ok: true });
  }

  // Extract text from message parts
  const textParts = (data.parts || [])
    .filter((part: { type: string }) => part.type === "text")
    .map((part: { value: string }) => part.value);
  const userMessage = textParts.join(" ").trim();

  if (!userMessage) {
    return NextResponse.json({ ok: true });
  }

  const chatId = data.chat?.id;
  if (!chatId) {
    console.error("No chat ID in webhook payload");
    return NextResponse.json({ ok: true });
  }

  console.log(`Incoming message from ${data.sender_handle?.handle}: "${userMessage}"`);

  // Respond quickly to Linq, then process async
  // Using waitUntil pattern for Vercel
  try {
    const aiResponse = await generateAIResponse(userMessage);
    console.log(`AI response: "${aiResponse}"`);
    await sendLinqMessage(chatId, aiResponse);
    console.log("Reply sent successfully");
  } catch (error) {
    console.error("Error processing message:", error);
  }

  return NextResponse.json({ ok: true });
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "linq-imessage-bot",
    timestamp: new Date().toISOString(),
  });
}
