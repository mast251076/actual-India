# Deploying Actual Budget with Supabase (PostgreSQL)

This guide explains how to deploy the Actual Budget application with a Supabase PostgreSQL backend instead of the default SQLite.

## Overview

We have modified the `sync-server` to support PostgreSQL and refactored the database interaction layer to be asynchronous. This allows you to use managed databases like Supabase.

## 1. Supabase Setup (Backend Database)

1.  **Create a Supabase Project:**
    *   Go to [supabase.com](https://supabase.com/) and create a new project.
    *   Set a strong database password and note it down.

2.  **Initialize Database Schema:**
    *   In your Supabase dashboard, go to the **SQL Editor**.
    *   Click "New query".
    *   Copy and paste the contents of `supabase_schema.sql` (found in the root of this project) into the editor.
    *   Click **Run**. This will create the `users`, `auth`, `sessions`, `files`, `user_access`, and `secrets` tables.

3.  **Get Connection String:**
    *   Go to **Project Settings** > **Database**.
    *   Under "Connection string", select **URI**.
    *   Copy the URI. It should look like `postgresql://postgres:[YOUR-PASSWORD]@[YOUR-HOST]:5432/postgres`.
    *   **Crucial:** Replace `[YOUR-PASSWORD]` with the password you set for the database.

## 2. Netlify Setup (Frontend)

The frontend is a static React app and can be easily hosted on Netlify.

1.  **Push your code to GitHub/GitLab/Bitbucket.**
2.  **Connect to Netlify:**
    *   Go to [netlify.com](https://www.netlify.com/) and click "Add new site" > "Import an existing project".
    *   Select your repository.
3.  **Configure Build Settings:**
    *   The project already contains a `netlify.toml` which should auto-configure these settings:
        *   **Build command:** `yarn build:browser`
        *   **Publish directory:** `packages/desktop-client/build`
    *   **Environment Variables:**
        *   `NODE_VERSION`: `22`
4.  **Deploy:** Click "Deploy site".

## 3. Sync Server Deployment (Backend Logic)

You need a platform that runs Node.js to host the `sync-server`. Good options include [Fly.io](https://fly.io/), [Railway](https://railway.app/), or any VPS.

1.  **Environment Variables:**
    Set the following on your hosting provider:
    *   `ACTUAL_DATABASE_TYPE`: `postgres`
    *   `ACTUAL_DATABASE_URL`: `[Your Supabase URI from step 1]`
    *   `ACTUAL_LOGIN_METHOD`: `password` (or `openid` / `header`)
    *   `ACTUAL_SERVER_FILES`: `/data/server-files` (where it stores budget files; you should volume-mount this if possible)
    *   `ACTUAL_USER_FILES`: `/data/user-files`
    *   `NODE_ENV`: `production`

2.  **Build & Start:**
    The server can be started with `yarn workspace @actual-app/sync-server start`.
    If using Docker, use the `sync-server.Dockerfile` in the root (you might need to adjust it to ensure the code changes are included).

## Important Note on Budget Files

While the **account data** (users, sessions, file metadata) is now stored in Supabase, the **actual budget data** (your `.sqlite` files) are still stored on the server's filesystem in the `ACTUAL_USER_FILES` directory.

When you upload a budget, it goes to this directory. If your `sync-server` container restarts and doesn't have a persistent volume, you will lose access to your budget files (though the metadata in Supabase will remain). **Always ensure you have persistent storage for the `user-files` directory.**

## Troubleshooting

If you see "Promise" or "async" related errors in the server logs, it's possible a database call was missed in the refactor. Please report these errors.
