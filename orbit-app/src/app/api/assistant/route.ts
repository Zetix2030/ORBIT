import { NextRequest, NextResponse } from "next/server";

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

const SYSTEM_PROMPT = `
Tu es ORBIT Assistant, l'assistant IA intégré au produit ORBIT.

ORBIT est un moteur de recherche et d'aide à la décision.
Pour l'instant, son cas d'usage principal est l'immobilier :
il comprend une demande en langage naturel, cherche des sources sur le web,
détecte des annonces individuelles, extrait leurs données et les classe.

Ton rôle :
- tenir une vraie conversation avec l'utilisateur ;
- utiliser le contexte des messages précédents ;
- expliquer ORBIT sans répéter mot pour mot les mêmes réponses ;
- aider à mieux formuler une recherche immobilière ;
- expliquer budget, surface, chambres, DPE, prix au m², jardin, garage,
  scores, points forts et compromis ;
- comparer des idées ou critères lorsqu'ils sont fournis ;
- répondre dans la langue de l'utilisateur.

Style :
- naturel, direct et utile ;
- généralement 2 à 5 phrases ;
- varie tes formulations ;
- ne commence pas chaque réponse par "ORBIT..." ;
- évite les répétitions et les paragraphes inutiles ;
- pose une question de suivi uniquement si elle apporte vraiment quelque chose.

Important :
- ne prétends pas avoir fait une recherche web si aucune donnée de recherche
  n'est fournie dans la conversation ;
- ne prétends pas connaître une annonce précise sans données à son sujet ;
- si l'utilisateur veut trouver un bien, invite-le à utiliser la recherche ORBIT ;
- si une information manque, dis-le clairement.
`;

function extractOutputText(payload: OpenAIResponse) {
  if (
    typeof payload.output_text === "string" &&
    payload.output_text.trim()
  ) {
    return payload.output_text.trim();
  }

  const chunks: string[] = [];

  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "OPENAI_API_KEY n'est pas configurée dans .env.local.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();

    const messages: AssistantMessage[] = Array.isArray(
      body?.messages,
    )
      ? body.messages
          .filter(
            (
              message: unknown,
            ): message is AssistantMessage => {
              if (
                typeof message !== "object" ||
                message === null
              ) {
                return false;
              }

              const candidate =
                message as Partial<AssistantMessage>;

              return (
                (candidate.role === "user" ||
                  candidate.role === "assistant") &&
                typeof candidate.content === "string" &&
                candidate.content.trim().length > 0
              );
            },
          )
          .slice(-8)
      : [];

    if (messages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Aucun message à traiter.",
        },
        { status: 400 },
      );
    }

    const input = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      12000,
    );

    let response: Response;

    try {
      response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.4-mini",
            input,
            reasoning: {
              effort: "none",
            },
            max_output_tokens: 260,
          }),
          signal: controller.signal,
          cache: "no-store",
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const payload =
      (await response.json()) as OpenAIResponse;

    if (!response.ok) {
      console.error(
        "OpenAI assistant error:",
        response.status,
        payload,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            payload.error?.message ||
            "L'assistant ORBIT n'est pas disponible.",
        },
        { status: response.status },
      );
    }

    const answer =
      extractOutputText(payload);

    if (!answer) {
      return NextResponse.json(
        {
          success: false,
          error:
            "L'assistant n'a généré aucune réponse.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      answer,
    });
  } catch (error) {
    console.error(
      "ORBIT assistant route error:",
      error,
    );

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "L'assistant a dépassé le délai de réponse.",
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Impossible de contacter l'assistant ORBIT.",
      },
      { status: 500 },
    );
  }
}