# Youtugtog

A minimal YouTube playlist player built with React, Vite, and Tailwind CSS.

## Local setup

1. Copy `.env.example` to `.env`.
2. Open `.env` and set your YouTube API key:
   ```env
   YOUTUBE_API_KEY=YOUR_KEY_HERE
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Notes

- The app uses a local `/api/search` proxy for YouTube Data API requests.
- Keep `.env` private; it is ignored by Git via `.gitignore`.
