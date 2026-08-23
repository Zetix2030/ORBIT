"use client";

import { useEffect } from "react";

const EXAMPLE_REPLACEMENTS: Record<string, string> = {
  "Maison à Londres moins de 600 000 £, 3 chambres": "Appartement à Paris moins de 650 000 €, 3 chambres",
  "Villa à Miami moins de 1 200 000 $, piscine et garage": "Maison à Bordeaux moins de 550 000 €, jardin et garage",
};

const TEXT_REPLACEMENTS: Record<string, string> = {
  "Maison à Londres, 3 chambres, moins de 600 000 £": "Appartement à Paris, 3 chambres, moins de 650 000 €",
  "London, UK": "Paris, France",
  "600 000 £": "650 000 €",
  "£589,000": "629 000 €",
  "£575,000": "615 000 €",
  "3 bedroom terraced house": "Appartement familial 3 chambres",
  "Family house with garden": "Maison familiale avec jardin",
  "Greater London": "Paris et petite couronne",
};

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function launchExample(query: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Décris exactement ce que tu recherches..."]');
  if (!input) return;
  setReactInputValue(input, query);
  window.setTimeout(() => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (item) => item.textContent?.trim() === "Lancer ORBIT",
    );
    button?.click();
  }, 40);
}

export default function FranceOnlyUiGuard() {
  useEffect(() => {
    const bound = new WeakSet<Element>();

    const patch = () => {
      for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button"))) {
        const original = button.textContent?.trim() ?? "";
        const replacement = EXAMPLE_REPLACEMENTS[original];
        if (!replacement) continue;

        button.textContent = replacement;
        if (!bound.has(button)) {
          button.addEventListener(
            "click",
            (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.stopImmediatePropagation();
              launchExample(replacement);
            },
            true,
          );
          bound.add(button);
        }
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = node.nodeValue?.trim() ?? "";
        const replacement = TEXT_REPLACEMENTS[value];
        if (replacement && node.nodeValue) node.nodeValue = node.nodeValue.replace(value, replacement);
        node = walker.nextNode();
      }
    };

    patch();
    const observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
