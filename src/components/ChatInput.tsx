import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSendMessage, disabled }: ChatInputProps) => {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card border p-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] focus-within:border-input" /* taste-skill-ignore: the composer floats */
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 px-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a coin or stock"
            aria-label="Ask Pulse"
            className="border-0 bg-transparent text-base focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
            disabled={disabled}
          />
        </div>

        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || disabled}
          aria-label="Send"
          className="bar-cut bg-brand hover:bg-brand/90 active:translate-y-px transition-[background-color,transform] w-12 h-12 pt-1 flex-shrink-0"
        >
          <Send className="w-5 h-5 text-brand-foreground" />
        </Button>
      </div>
    </form>
  );
};

export default ChatInput;
