export interface RecipientInfo {
  age: string;
  gender: string;
  relationship: string;
  interests: string;
  occasion: string;
  budget: string;
  personality: string;
  image?: string; // Base64 encoded image
}

export interface GiftOption {
  name: string;
  description: string;
  priceRange: string;
  whyItsPerfect: string;
  searchQuery: string;
  asin: string;
  category: string;
}

export interface GiftRecommendationResponse {
  recommendations: GiftOption[];
  summary: string;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
