import { StackActionButton } from './StackActionButton';

interface StackActionBtnProps {
  label: string;
  onRestart: () => void;
  onUp: () => void;
  onBuild: () => void;
}

// Why: backward compatibility alias preserves existing imports while canonical name uses full words
export function StackActionBtn(props: StackActionBtnProps) {
  return <StackActionButton {...props} />;
}
