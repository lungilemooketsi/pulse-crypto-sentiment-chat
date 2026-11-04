import { lazy, Suspense } from "react";
import { Message } from "@/pages/Index";
import { User } from "lucide-react";
import { PulseMark } from "./PulseLogo";
import ReactMarkdown from "react-markdown";
// Recharts is large, so it loads only when a reply has a chart to show.
const CoinChart = lazy(() => import("./CoinChart"));

interface ChatMessageProps {
  message: Message;
}

const ChatMessage = ({ message }: ChatMessageProps) => {
  const isUser = message.role === "user";
  const charts = !isUser && message.coins?.length ? message.coins : null;

  return (
    <div
      data-message-id={message.id}
      className={`message-in flex scroll-mt-24 ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`flex gap-3 max-w-2xl ${isUser ? "flex-row-reverse" : "flex-row"} ${charts ? "w-full" : ""}`}>
        {/* Avatar */}
        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 bg-secondary">
          {isUser ? (
            <User className="w-4 h-4 text-muted-foreground" aria-label="You" />
          ) : (
            <PulseMark className="w-5 h-5 text-brand" />
          )}
        </div>

        {/* Message Content */}
        <div className={`flex flex-col gap-1 ${charts ? "flex-1 min-w-0" : ""}`}>
          {charts && (
            <div className="space-y-2 mb-1">
              <Suspense fallback={<div className="h-[19rem] bg-card border" aria-hidden="true" />}>
                {charts.map((query) => (
                  <CoinChart key={"coin" in query ? query.coin.id : query.cashtag} query={query} />
                ))}
              </Suspense>
            </div>
          )}
          <div
            className={`px-5 py-3 ${isUser ? "bg-secondary" : "bg-card border"}`}
          >
            {isUser ? (
              <p className="text-base">{message.content}</p>
            ) : (
              <div className="prose prose-invert max-w-none prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-headings:text-foreground prose-p:my-3 first:prose-p:mt-0 prose-li:my-1">
                <ReactMarkdown>{message.content || "..."}</ReactMarkdown>
              </div>
            )}
          </div>

          {/* Timestamp, and on replies the educational notice */}
          <span className={`text-xs text-muted-foreground ${isUser ? "text-right" : "text-left"}`}>
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {!isUser && message.id !== "welcome" && " · Educational, not financial advice"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
