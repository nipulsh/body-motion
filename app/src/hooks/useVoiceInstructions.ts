import { useCallback, useEffect, useRef } from 'react';

interface SpeakOptions {
  priority?: 'normal' | 'high';
}

export function useVoiceInstructions(enabled = true) {
  const queueRef = useRef<string[]>([]);
  const speakingRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const processQueue = useCallback(() => {
    if (!enabled || speakingRef.current || queueRef.current.length === 0) return;
    if (!window.speechSynthesis) return;

    const text = queueRef.current.shift();
    if (!text) return;

    speakingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => {
      speakingRef.current = false;
      utteranceRef.current = null;
      processQueue();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      utteranceRef.current = null;
      processQueue();
    };
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [enabled]);

  const speak = useCallback(
    (text: string, options?: SpeakOptions) => {
      if (!enabled || !text.trim()) return;
      if (options?.priority === 'high') {
        queueRef.current = [text];
        window.speechSynthesis?.cancel();
        speakingRef.current = false;
      } else if (!queueRef.current.includes(text)) {
        queueRef.current.push(text);
      }
      processQueue();
    },
    [enabled, processQueue],
  );

  const cancel = useCallback(() => {
    queueRef.current = [];
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
    utteranceRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return { speak, cancel };
}
