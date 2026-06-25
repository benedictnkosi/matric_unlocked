This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database

Firestore collections, field definitions, document IDs, and relationships are documented in [DATABASE.md](./DATABASE.md).

## Scripts

# seed question
npm run seed:questions


# Preview which topics would be processed
npm run generate:sub-topics -- --dry-run

# Filter by subject or grade
npm run generate:sub-topics -- --subject "Mathematics P1" --grade 12


delete questions by subject
# Preview what would be deleted
npm run delete:subject -- --subject "Mathematics P1" --grade 1 --dry-run

# Actually delete (requires --confirm)
npm run delete:subject -- --subject "Mathematics P1" --grade 1 --confirm

# Shorthand with positional subject name
npm run delete:subject -- "Mathematics P1" --grade 1 --confirm

generate sub topic script

# Preview what would be processed
npm run generate:video-scripts -- --dry-run

# Regenerate even if a script already exists
npm run generate:video-scripts -- --force

# Filter by subject or grade
npm run generate:video-scripts -- --subject "Mathematics P1" --grade 1



# Preview which questions would be checked
npm run check:image-required -- --dry-run

# Test on a few questions
npm run check:image-required -- --limit 10

# Filter by subject or grade
npm run check:image-required -- --subject "Geography P1" --grade 1

# Re-apply any unapplied image_required results from progress file
npm run check:image-required -- --apply




# Classify questions into sub-topics with Ollama
npm run classify:sub-topics -- --dry-run
npm run classify:sub-topics -- --limit 10
npm run classify:sub-topics -- --subject "Mathematics P1" --grade 1

# Generate PNG images for questions with an image_path containing .png
npm run generate:question-images -- --dry-run
npm run generate:question-images -- --limit 5
npm run generate:question-images -- --subject "Business Studies P1" --grade 1


# Preview
npm run classify:sub-topics -- --dry-run

# Classify 10 questions
npm run classify:sub-topics -- --limit 10

# Filter by subject/grade
npm run classify:sub-topics -- --subject "Business Studies P1" --grade 1

# Reclassify questions that already have subTopic
npm run classify:sub-topics -- --force --limit 10


# generate images
# Preview
npm run generate:question-images -- --dry-run

# Generate 5 images
npm run generate:question-images -- --limit 5

# Filter by subject
npm run generate:question-images -- --subject "Business Studies P1" --grade 1



# Preview what would be generated (747 topics found in your DB)
npm run generate:topic-images -- --dry-run

# Generate all grade 1 topic images
npm run generate:topic-images

# Generate for one subject only
npm run generate:topic-images -- --subject "Business Studies P1"
npm run generate:topic-images -- "Mathematics"

# Test with a small batch first
npm run generate:topic-images -- --limit 3

# Flag form (exact paper name)
npm run generate:topic-images -- --subject "Business Studies P1"

# Positional form
npm run generate:topic-images -- "Business Studies P1"

# Base name matches all papers for that subject
npm run generate:topic-images -- "Mathematics"   # matches Mathematics P1 and P2