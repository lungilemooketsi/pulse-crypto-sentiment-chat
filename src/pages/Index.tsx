import { useEffect, useRef, useState } from "react";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import PromptChips from "@/components/PromptChips";
import { Button } from "@/components/ui/button";
import { Link, useSearchParams } from "react-router-dom";
import { PulseInline } from "@/components/PulseLogo";
import { sendChatMessage, streamChatResponse, type ChatMessage as ModelChatMessage } from "@/lib/chat";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { createConversation, loadLatestConversation, saveMessage } from "@/lib/history";
import { loadHistory } from "@/lib/datasets";
import { detectCoins, enableStocks, priceContext, type CoinQuery } from "@/lib/market";
import { contextFor, loadSnapshot } from "@/lib/sentiment";
import { toast } from "sonner";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  // Coins the question named; an assistant reply shows a price chart for each.
  coins?: CoinQuery[];
};

const welcomeMessage = (): Message => ({
  id: "welcome",
  role: "assistant",
  content: "Ask me about any coin or stock.",
  timestamp: new Date(),
});

const Index = () => {
  const { user, signOutUser } = useAuth();
  const [messages, setMessages] = useState<Message[]>([welcomeMessage()]);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const conversationHistory = useRef<ModelChatMessage[]>([]);
  const conversationId = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const carriedQuestionSent = useRef(false);
  // The prompt to bring to the top of the screen: the latest one when history loads, and each new one sent.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!scrollTarget) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-message-id="${scrollTarget}"]`)?.scrollIntoView({ block: "start" });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget, messages]);

  useEffect(() => {
    document.title = "Pulse · Chat";
    loadHistory().then((history) => {
      const stocks = Object.entries(history?.assets ?? {}).filter(([, asset]) => asset.kind === "stock");
      enableStocks(stocks.map(([symbol]) => symbol));
    });
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    loadLatestConversation(db, user.uid)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded || loaded.messages.length === 0) {
          conversationId.current = loaded?.id ?? null;
          conversationHistory.current = [];
          setMessages([welcomeMessage()]);
          return;
        }
        conversationId.current = loaded.id;
        conversationHistory.current = loaded.messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
        const restored: Message[] = loaded.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: new Date(message.createdAt),
        }));
        // Only the latest reply about a coin gets its chart back, so an old thread doesn't fire a request per coin.
        for (let index = restored.length - 1; index > 0; index--) {
          const question = restored[index - 1];
          if (restored[index].role !== "assistant" || question.role !== "user") continue;
          const coins = detectCoins(question.content);
          if (coins.length) {
            restored[index] = { ...restored[index], coins };
            break;
          }
        }
        setMessages(restored);
        const lastPrompt = [...restored].reverse().find((message) => message.role === "user");
        if (lastPrompt) setScrollTarget(lastPrompt.id);
      })
      .catch((error) => {
        console.error("Error loading chat history:", error);
        if (!cancelled) toast.error("Could not load your chat history.");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSendMessage = async (content: string) => {
    if (!user || !db || historyLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev.filter((message) => message.id !== "welcome"), userMessage]);
    setScrollTarget(userMessage.id);
    setIsLoading(true);

    const priorHistory = conversationHistory.current.slice();
    let assistantText = "";

    try {
      const id = conversationId.current ?? (await createConversation(db, user.uid));
      conversationId.current = id;
      await saveMessage(db, user.uid, id, "user", content);
      conversationHistory.current = [...priorHistory, { role: "user", content }];

      const aiMessageId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: aiMessageId, role: "assistant", content: "", timestamp: new Date(), coins: detectCoins(content) },
      ]);

      const token = await user.getIdToken();
      const queries = detectCoins(content);
      const symbols = queries.flatMap((query) => ("coin" in query ? [query.coin.symbol] : [query.cashtag]));
      const [mood, prices] = queries.length ? await Promise.all([loadSnapshot().then((s) => contextFor(s, symbols)), priceContext(queries)]) : [null, null];
      const context = [prices, mood].filter(Boolean).join("\n\n") || null;
      const response = await sendChatMessage(content, priorHistory, token, context);
      for await (const chunk of streamChatResponse(response)) {
        assistantText += chunk;
        setMessages((prev) =>
          prev.map((message) => (message.id === aiMessageId ? { ...message, content: assistantText } : message)),
        );
      }

      if (assistantText) {
        conversationHistory.current = [
          ...priorHistory,
          { role: "user", content },
          { role: "assistant", content: assistantText },
        ];
        await saveMessage(db, user.uid, id, "assistant", assistantText);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");
      setMessages((prev) => prev.filter((message) => message.role !== "assistant" || message.content !== ""));
    } finally {
      setIsLoading(false);
    }
  };

  // A question typed on the landing page rides along through sign-up and is asked once history has loaded.
  useEffect(() => {
    const carried = searchParams.get("q")?.trim();
    if (!carried || historyLoading || carriedQuestionSent.current) return;
    carriedQuestionSent.current = true;
    setSearchParams({}, { replace: true });
    void handleSendMessage(carried.slice(0, 500));
    // handleSendMessage is recreated each render; the ref guard keeps this to one send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoading, searchParams, setSearchParams]);

  const handleSignOut = async () => {
    conversationId.current = null;
    conversationHistory.current = [];
    setMessages([welcomeMessage()]);
    await signOutUser();
  };

  return (
    <div className="min-h-svh flex flex-col">
      <header className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-border" /* taste-skill-ignore: app bar edge */>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" aria-label="Pulse home" className="flex items-center gap-3">
            <PulseInline height={28} />
          </Link>
          <h1 className="sr-only">Pulse chat</h1>
          <div className="flex items-center gap-3">
            <Link to="/lab" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Lab
            </Link>
            <Link to="/anomalies" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Anomalies
            </Link>
            {user?.email && <span className="text-sm text-muted-foreground hidden sm:inline">{user.email}</span>}
            <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-24 pb-48 overflow-y-auto">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="space-y-6">
            {historyLoading && <p className="text-sm text-muted-foreground">Loading your conversations...</p>}
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-card border px-5 py-3 max-w-xs" role="status">
                  <div className="flex items-center gap-3">
                    <span className="bar-loader" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="text-sm text-muted-foreground">Analysing...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Room below the latest reply, so the latest prompt can sit at the top of the screen while the reply is short. */}
          {messages.some((message) => message.role === "user") && <div className="h-[calc(100svh-20rem)]" aria-hidden="true" />}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 pb-6 pt-3 bg-background">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="space-y-4">
            <PromptChips onPromptClick={handleSendMessage} />
            <ChatInput onSendMessage={handleSendMessage} disabled={isLoading || historyLoading} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
