"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { ProjectDetailDTO } from "@/lib/types";
import { Icon, Spinner, cx } from "../ui";

export interface ChatHandle { focus(prefill?: string): void }

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className={cx(i > 0 && "mt-1.5", !line && "h-2")}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>))}
        </p>
      ))}
    </>
  );
}

const SUGGESTIONS_MODEL = ["Make it 10% bigger", "Make it 20 cm wide", "Add holes on both sides", "Make a box with a lid for this", "Make it wall-mountable"];
const SUGGESTIONS_EMPTY = ["Make a box with lid, 80 x 50 x 30 mm", "Make a phone holder", "Make a wall hook"];

export const ChatPanel = forwardRef<ChatHandle, { project: ProjectDetailDTO; onChange: () => Promise<unknown>; onActivateVersion: (id: string) => void }>(function ChatPanel({ project, onChange, onActivateVersion }, ref) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = !!project.activeJob;
  const thinking = project.activeJob?.kind === "chat";

  useImperativeHandle(ref, () => ({ focus: (prefill) => { if (prefill !== undefined) setText(prefill); setTimeout(() => input.current?.focus(), 30); } }));
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [project.messages.length, thinking, pending]);
  useEffect(() => { if (pending && project.messages.some((m) => m.role === "user" && m.content === pending)) setPending(null); }, [project.messages, pending]);

  async function send(msg = text) {
    const t = msg.trim();
    if (!t || sending || busy) return;
    setSending(true);
    setError(null);
    setPending(t);
    setText("");
    try {
      await api(`/api/projects/${project.id}/chat`, { method: "POST", json: { message: t } });
      await onChange();
    } catch (e) {
      setPending(null);
      setText(t);
      setError(e instanceof ApiError ? e.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  const hasModel = !!project.currentVersionId;
  const chips = hasModel ? [...(project.analysis?.suggestions.slice(0, 2) ?? []), ...SUGGESTIONS_MODEL] : SUGGESTIONS_EMPTY;
  const empty = project.messages.length === 0 && !pending;

  return (
    <div className="flex h-full min-h-[22rem] flex-col">
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {empty && (
          <div className="grid place-items-center gap-2 py-8 text-center text-sm text-ink-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-accent-soft text-accent"><Icon name="sparkle" className="size-5" /></span>
            <p className="max-w-[16rem]">{hasModel ? "Tell me what you want to do with this model." : "Describe what you want to make – or scan an object first."}</p>
          </div>
        )}
        {project.messages.map((m) => (
          <div key={m.id} className={cx("rise flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed", m.role === "user" ? "rounded-br-md bg-ink text-white" : m.meta?.kind === "error" ? "rounded-bl-md bg-bad-soft text-bad" : "rounded-bl-md bg-black/[.045]")}>
              <RichText text={m.content} />
              {m.versionId && project.versions.find((v) => v.id === m.versionId) && (
                <button onClick={() => onActivateVersion(m.versionId!)} className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink shadow-sm ring-1 ring-black/5 hover:bg-bg">
                  <Icon name="cube" className="size-3" /> View v{project.versions.find((v) => v.id === m.versionId)!.number}
                </button>
              )}
            </div>
          </div>
        ))}
        {pending && <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] text-white opacity-70">{pending}</div></div>}
        {(thinking || (sending && !pending)) && (
          <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-black/[.045] px-3.5 py-2.5 text-sm text-ink-2"><Spinner className="size-3.5" /> {project.activeJob?.stage ?? "Thinking"}…</div></div>
        )}
        <div ref={bottom} />
      </div>

      <div className="border-t hairline p-3">
        {!busy && (
          <div className="scroll-thin -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {chips.map((c) => <button key={c} onClick={() => setText(c)} className="shrink-0 rounded-full border border-line bg-white px-3 py-1 text-xs text-ink-2 transition hover:border-line-strong hover:text-ink">{c}</button>)}
          </div>
        )}
        {error && <p className="mb-2 text-xs text-bad" role="alert">{error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
          <textarea
            ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={busy ? "Working…" : hasModel ? "e.g. “make it 10% bigger”" : "Describe what you want to make…"}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line-strong bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-accent disabled:bg-bg"
          />
          <button type="submit" disabled={!text.trim() || busy || sending} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-white transition hover:bg-black/85 disabled:bg-ink/25"><Icon name="send" className="size-5" /></button>
        </form>
      </div>
    </div>
  );
});
