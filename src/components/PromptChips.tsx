import { Button } from "./ui/button";

interface PromptChipsProps {
  onPromptClick: (prompt: string) => void;
}

const prompts = [
  "Analyse Bitcoin sentiment",
  "How is Apple doing this week?",
  "Compare BTC vs ETH sentiment",
  "Compare Nvidia and Tesla",
  "What does the fear & greed index measure?",
  "What is an ETF?",
  "What makes an investment high risk?",
  "What is dollar-cost averaging?",
];

const PromptChips = ({ onPromptClick }: PromptChipsProps) => {
  return (
    <div className="overflow-x-auto pb-2 scrollbar-hide">
      <div className="flex gap-2 min-w-max">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            variant="secondary"
            size="sm"
            onClick={() => onPromptClick(prompt)}
            className="h-9 whitespace-nowrap hover:bg-accent active:translate-y-px transition-[background-color,transform]"
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
};

export default PromptChips;
