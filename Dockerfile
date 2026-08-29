# ask-site (RAG Q&A) for Railway.
# The 186MB RAG index is pulled from R2 into the volume at boot; ask.db (rw)
# also lives on the volume. Query embeddings come from the lakeside-ollama service.
FROM node:22-slim
WORKDIR /app

# build tools for better-sqlite3 native compile fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci && npm i --no-save @aws-sdk/client-s3

COPY . .

# Fetch the index from R2 (if absent) then start the server.
ENV HOST=0.0.0.0
CMD ["sh", "-c", "node scripts/fetch-index.mjs && node server.js"]
