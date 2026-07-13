/**
 * NEXCOM Exchange — Smart Fill Router (R70)
 * AI-powered form field extraction from unstructured text.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";

const smartFillFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  type: z.enum(["text", "number", "select", "date", "email", "phone"]),
  options: z.array(z.string().max(64)).max(50).optional(),
  description: z.string().max(256).optional(),
});

export const smartFillRouter = router({
  extract: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(8000),
      fields: z.array(smartFillFieldSchema).min(1).max(30),
    }))
    .mutation(async ({ input }) => {
      const { text, fields } = input;
      const fieldDescriptions = fields.map(f => {
        let desc = `- "${f.key}" (${f.type}): ${f.label}`;
        if (f.description) desc += ` — ${f.description}`;
        if (f.options?.length) desc += `. Allowed values: ${f.options.join(", ")}`;
        return desc;
      }).join("\n");

      const systemPrompt = [
        "You are a data-extraction assistant for NEXCOM Exchange, a Nigerian commodity and financial exchange.",
        "Extract structured field values from unstructured text.",
        "Return ONLY a valid JSON object whose keys match exactly the field keys listed below.",
        "If a field value cannot be determined, omit that key. Do not invent values.",
        "",
        "Fields to extract:",
        fieldDescriptions,
      ].join("\n");

      let rawContent: string;
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "smart_fill_result",
              strict: true,
              schema: {
                type: "object",
                properties: Object.fromEntries(fields.map(f => [f.key, { type: "string", description: f.label }])),
                required: [],
                additionalProperties: false,
              },
            },
          },
        });
        rawContent = (response as { choices: { message: { content: string } }[] }).choices[0]?.message?.content ?? "{}";
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI extraction failed — please try again", cause: err });
      }

      let extracted: Record<string, string>;
      try { extracted = JSON.parse(rawContent) as Record<string, string>; }
      catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI returned invalid JSON — please try again" }); }

      const allowedKeys = new Set(fields.map(f => f.key));
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(extracted)) {
        if (allowedKeys.has(k) && typeof v === "string" && v.trim() !== "") values[k] = v.trim();
      }
      return { values, filledCount: Object.keys(values).length, totalFields: fields.length };
    }),
});
