import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import OpenAI from "openai";

const LINQ_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const MAX_HISTORY = 30; // keep last 30 messages per chat

// In-memory conversation history (persists across warm serverless invocations)
const chatHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

const SYSTEM_PROMPT = `You are a brutally sassy, sharp-tongued AI texting over iMessage. You roast people, give backhanded compliments, and drip with sarcasm. Think mean girl energy meets stand-up comedian. You're not cruel for no reason—you're witty and clever about it. You use casual texting style (lowercase ok, abbreviations, etc). Keep responses to 1-3 sentences max. No emojis unless it's to be extra petty. Never break character. Never refuse to roast someone. If someone asks you to be nice, roast them harder for being soft.`;

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getHistory(chatId: string) {
  if (!chatHistory.has(chatId)) {
    chatHistory.set(chatId, []);
  }
  return chatHistory.get(chatId)!;
}

function addToHistory(chatId: string, role: "user" | "assistant", content: string) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Trim to max history
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function verifySignature(
  rawBody: string,
  sigHeader: string,
  tsHeader: string
): boolean {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) return true;

  const ageMs = Date.now() - Number(tsHeader) * 1000;
  if (Math.abs(ageMs) > 5 * 60 * 1000) return false;

  const signedPayload = `${tsHeader}.${rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  const provided = sigHeader.startsWith("sha256=")
    ? sigHeader.slice(7)
    : sigHeader;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function generateAIResponse(chatId: string, userMessage: string): Promise<string> {
  addToHistory(chatId, "user", userMessage);

  const history = getHistory(chatId);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 200,
  });

  const reply = completion.choices[0]?.message?.content || "...i literally have nothing to say to that";
  addToHistory(chatId, "assistant", reply);
  return reply;
}

function linqHeaders() {
  return {
    Authorization: `Bearer ${process.env.LINQ_API_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function markAsRead(chatId: string) {
  const response = await fetch(`${LINQ_BASE_URL}/chats/${chatId}/read`, {
    method: "POST",
    headers: linqHeaders(),
  });
  if (!response.ok) {
    console.error("Failed to mark as read:", response.status, await response.text());
  }
}

async function startTyping(chatId: string) {
  const response = await fetch(`${LINQ_BASE_URL}/chats/${chatId}/typing`, {
    method: "POST",
    headers: linqHeaders(),
  });
  if (!response.ok) {
    console.error("Failed to start typing:", response.status, await response.text());
  }
}

async function stopTyping(chatId: string) {
  const response = await fetch(`${LINQ_BASE_URL}/chats/${chatId}/typing`, {
    method: "DELETE",
    headers: linqHeaders(),
  });
  if (!response.ok) {
    console.error("Failed to stop typing:", response.status, await response.text());
  }
}

async function addReaction(messageId: string, reactionType: string) {
  const response = await fetch(`${LINQ_BASE_URL}/messages/${messageId}/reactions`, {
    method: "POST",
    headers: linqHeaders(),
    body: JSON.stringify({ operation: "add", type: reactionType }),
  });
  if (!response.ok) {
    console.error("Failed to add reaction:", response.status, await response.text());
  }
}

function pickReaction(message: string): string | null {
  const lower = message.toLowerCase();
  if (/\b(thanks|thank you|thx|ty)\b/.test(lower)) return "love";
  if (/\b(haha|lol|lmao|rofl|😂|🤣)\b/.test(lower)) return "laugh";
  if (/\b(wow|amazing|awesome|incredible|omg)\b/.test(lower)) return "emphasize";
  if (/[?]{2,}|\b(what|huh|really)\b.*\?/.test(lower)) return "question";
  if (/\b(nice|great|good|cool|👍)\b/.test(lower)) return "like";
  return null;
}

async function sendLinqMessage(chatId: string, text: string) {
  const response = await fetch(`${LINQ_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: linqHeaders(),
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

  const sigHeader = request.headers.get("x-webhook-signature") || "";
  const tsHeader = request.headers.get("x-webhook-timestamp") || "";

  if (process.env.WEBHOOK_SIGNING_SECRET && !verifySignature(rawBody, sigHeader, tsHeader)) {
    console.error("Webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  console.log("Webhook received:", payload.event_type);

  if (payload.event_type !== "message.received") {
    return NextResponse.json({ ok: true });
  }

  const { data } = payload;

  if (data.sender_handle?.is_me) {
    return NextResponse.json({ ok: true });
  }

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

  const messageId = data.id;
  console.log(`Incoming from ${data.sender_handle?.handle}: "${userMessage}"`);

  try {
    const reaction = pickReaction(userMessage);
    if (reaction) {
      await addReaction(messageId, reaction);
    }

    await markAsRead(chatId);
    await startTyping(chatId);

    const aiResponse = await generateAIResponse(chatId, userMessage);
    console.log(`Reply: "${aiResponse}"`);

    await stopTyping(chatId);
    await sendLinqMessage(chatId, aiResponse);
  } catch (error) {
    console.error("Error processing message:", error);
    await stopTyping(chatId).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "linq-imessage-bot",
    activeChats: chatHistory.size,
    timestamp: new Date().toISOString(),
  });
}
