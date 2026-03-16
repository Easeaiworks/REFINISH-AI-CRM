import { useState, useCallback, useRef } from 'react';

interface VoiceNavResult {
  command: string;
  path?: string;
  search?: string;
}

interface UseVoiceNavigationReturn {
  isListening: boolean;
  lastCommand: string;
  feedback: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
}

const NAV_ROUTES: { patterns: RegExp[]; path: string; label: string }[] = [
  { patterns: [/\b(dashboard|home|main|overview)\b/i], path: '/', label: 'Dashboard' },
  { patterns: [/\b(show|list|view|open|go\s*to)\s+(all\s+)?(accounts?|shops?|contacts?|customers?)\b/i, /^(accounts?|shops?|contacts?|customers?)$/i], path: '/accounts', label: 'Accounts' },
  { patterns: [/\b(show|go\s*to|open)\s+(all\s+)?(sales|revenue)\b/i, /^(sales|revenue|money|imports?)$/i], path: '/sales', label: 'Sales' },
  { patterns: [/\b(admin|settings?|users?|team)\b/i], path: '/admin', label: 'Admin' },
];

const SEARCH_PATTERNS = [
  /\b(?:search|find|look\s*up|show\s*me)\s+(.+)/i,
  /\b(?:who|where|what)(?:'s|s)?\s+(.+)/i,
];

const ACCOUNT_PATTERN = /\b(?:open|go\s*to|show|pull\s*up|view)\s+(.+?)(?:\s+account)?$/i;

// Patterns for sales/invoice customer lookups
const SALES_CUSTOMER_PATTERNS = [
  /\b(.+?)\s+(?:invoices?|sales|revenue|transactions?|orders?)\b/i,
  /\b(?:invoices?|sales|revenue|transactions?|orders?)\s+(?:for|from|of)\s+(.+)/i,
  /\b(?:show|pull\s*up|view|get|find)\s+(.+?)\s+(?:invoices?|sales|revenue|transactions?)\b/i,
];

// Patterns for salesperson lookups
const SALESPERSON_PATTERNS = [
  /\b(.+?)(?:'s|s)\s+(?:sales|revenue|numbers?|accounts?|customers?|invoices?)\b/i,
  /\b(?:sales|revenue|numbers?|invoices?)\s+(?:for|from|by)\s+(.+)/i,
];

export function useVoiceNavigation(
  onNavigate: (path: string) => void,
  onSearch?: (query: string) => void
): UseVoiceNavigationReturn {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState('');
  const [feedback, setFeedback] = useState('');
  const recognitionRef = useRef<any>(null);
  const feedbackTimeoutRef = useRef<any>(null);

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const isSupported = !!SpeechRecognition;

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setFeedback(''), 3000);
  }, []);

  const processCommand = useCallback((text: string) => {
    const cleaned = text.trim().toLowerCase();
    setLastCommand(cleaned);

    // Check navigation routes
    for (const route of NAV_ROUTES) {
      for (const pattern of route.patterns) {
        if (pattern.test(cleaned)) {
          showFeedback(`Going to ${route.label}`);
          onNavigate(route.path);
          return;
        }
      }
    }

    // Check for salesperson lookup (e.g. "Ben's sales", "revenue for Michelle")
    for (const pattern of SALESPERSON_PATTERNS) {
      const match = cleaned.match(pattern);
      const repName = (match?.[1] || match?.[2] || '').trim();
      if (repName && repName.length > 1) {
        showFeedback(`Showing sales by "${repName}"`);
        onNavigate(`/sales?rep=${encodeURIComponent(repName)}`);
        return;
      }
    }

    // Check for sales/invoice customer lookup (e.g. "parliament auto body invoices")
    for (const pattern of SALES_CUSTOMER_PATTERNS) {
      const match = cleaned.match(pattern);
      const customerName = (match?.[1] || match?.[2] || '').trim();
      if (customerName && customerName.length > 2) {
        showFeedback(`Showing sales for "${customerName}"`);
        onNavigate(`/sales?customer=${encodeURIComponent(customerName)}`);
        return;
      }
    }

    // Check for search commands
    for (const pattern of SEARCH_PATTERNS) {
      const match = cleaned.match(pattern);
      if (match && match[1]) {
        const query = match[1].trim();
        showFeedback(`Searching: "${query}"`);
        if (onSearch) {
          onSearch(query);
        } else {
          onNavigate(`/accounts?search=${encodeURIComponent(query)}`);
        }
        return;
      }
    }

    // Check for specific account navigation
    const accountMatch = cleaned.match(ACCOUNT_PATTERN);
    if (accountMatch && accountMatch[1]) {
      const name = accountMatch[1].trim();
      showFeedback(`Looking up "${name}"`);
      onNavigate(`/accounts?search=${encodeURIComponent(name)}`);
      return;
    }

    // Check for follow-up commands
    if (/\b(follow[\s-]?ups?|reminders?|upcoming|overdue)\b/i.test(cleaned)) {
      showFeedback('Going to Dashboard (follow-ups)');
      onNavigate('/');
      return;
    }

    // Check for dormant/inactive
    if (/\b(dormant|inactive|haven't contacted|overdue)\b/i.test(cleaned)) {
      showFeedback('Searching dormant accounts');
      if (onSearch) {
        onSearch('dormant accounts');
      } else {
        onNavigate('/accounts?search=dormant');
      }
      return;
    }

    // Check for add/create commands
    if (/\b(add|create|new)\s+(account|shop|contact)\b/i.test(cleaned)) {
      showFeedback('Opening Accounts to add new');
      onNavigate('/accounts?action=add');
      return;
    }

    // Fallback: treat as search
    if (cleaned.length > 2) {
      showFeedback(`Searching: "${cleaned}"`);
      if (onSearch) {
        onSearch(cleaned);
      } else {
        onNavigate(`/accounts?search=${encodeURIComponent(cleaned)}`);
      }
    } else {
      showFeedback("Didn't catch that. Try: 'go to dashboard' or 'find Maple Leaf'");
    }
  }, [onNavigate, onSearch, showFeedback]);

  const startListening = useCallback(() => {
    if (!isSupported) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setFeedback('Listening... say a command');
    };

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      processCommand(text);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        showFeedback(`Voice error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported, processCommand, showFeedback]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setFeedback('');
  }, []);

  return { isListening, lastCommand, feedback, startListening, stopListening, isSupported };
}
