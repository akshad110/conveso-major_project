# The engine, as a container.
#
# It has zero dependencies and imports nothing from the workspace, so there is
# no `npm install` here and no `packages/` to copy. That is worth preserving:
# this image is a Node base plus two directories, it builds in seconds, and it
# cannot break because a lockfile moved.
#
# Build from the repository ROOT, not from apps/courtroom-engine:
#   docker build -f deploy/engine.Dockerfile -t converso-engine .
FROM node:22-alpine

# Run as the node user rather than root. The engine serves files from its own
# public/ directory, and while that read is guarded against path traversal,
# "the guard held" is a worse story than "it had no privileges to abuse".
WORKDIR /app
RUN chown node:node /app
USER node

# Two directories, copied separately so a case-file edit does not invalidate
# the layer holding the source.
COPY --chown=node:node apps/courtroom-engine/package.json ./package.json
COPY --chown=node:node apps/courtroom-engine/src ./src
COPY --chown=node:node apps/courtroom-engine/server ./server
COPY --chown=node:node apps/courtroom-engine/public ./public
COPY --chown=node:node apps/courtroom-engine/cases ./cases

# 127.0.0.1 is the engine's default and is correct on a laptop. Inside a
# container it means "refuse every connection", which presents as a health
# check that never passes and no log line explaining why.
ENV HOST=0.0.0.0
ENV PORT=4177

# The case this process serves, fixed for the life of the process — there is no
# command to change it afterwards. One case per machine is a real constraint;
# see "One engine process serves one case" in DEPLOY.md.
ENV COURT_CASE=state-v-rane

# Set COURT_LLM_PROVIDER and the matching key as deployment secrets, not here.
# With neither, the engine runs its offline heuristics and says so on startup —
# a hearing that continues honestly rather than one that stalls.
EXPOSE 4177

# No npm in the entrypoint. `npm start` would fork a shell and a second process,
# which swallows SIGTERM and turns every deploy into a 30-second kill timeout.
CMD ["node", "server/index.js"]
