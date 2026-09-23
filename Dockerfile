FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE ./
COPY src ./src
COPY configs ./configs
COPY guardrails ./guardrails
COPY skills ./skills
COPY bench ./bench
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" CUALIGN_OUT=/app/out
EXPOSE 8000
# NVIDIA_API_KEY comes from the environment (docker run -e NVIDIA_API_KEY=... or --env-file .env)
CMD ["nat", "serve", "--config_file", "configs/workflow.yml", "--host", "0.0.0.0", "--port", "8000"]
