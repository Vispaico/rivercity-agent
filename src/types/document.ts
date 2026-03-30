export type Document = {
  id: string;            // Supabase IDs as strings
  slug: string;
  question: string;
  fullAnswer: string;
  shortSnippet: string;
  metaTitle?: string;
  metaDescription?: string;
};