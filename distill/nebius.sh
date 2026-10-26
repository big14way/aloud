#!/usr/bin/env bash
# Commands to run the distillation on Nebius AI Cloud Serverless AI. Read before running:
# each step creates billable resources. Usage: bash distill/nebius.sh <step>
#   upload   create the bucket and upload code + teacher data
#   train    start the training + evaluation job (1x L40S)
#   serve    start the vLLM endpoint for the distilled model
#   stop     stop the endpoint (stops compute billing; URL and token are kept)
#   start    start it again
# Needs: the nebius CLI (logged in), the AWS CLI configured for Nebius Object Storage
# (https://docs.nebius.com/object-storage/interfaces/aws-cli), and distill/data from generate.ts.
set -euo pipefail

BUCKET="${BUCKET:-aloud-distill}"
JOB_IMAGE="${JOB_IMAGE:-docker.io/axolotlai/axolotl:main-20260309-py3.11-cu128-2.9.1}"
VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.18.0-cu130}"
PLATFORM="${PLATFORM:-gpu-l40s-a}"
PRESET="${PRESET:-1gpu-8vcpu-32gb}"
ENDPOINT="${ENDPOINT:-aloud-nano}"
# The job is stopped after this long, so a stuck run can't keep billing (about $1.55/h on 1x L40S).
JOB_TIMEOUT="${JOB_TIMEOUT:-90m}"
SUBNET_ID="${SUBNET_ID:-$(nebius vpc subnet list --format jsonpath='{.items[0].metadata.id}')}"
bucket_id() { nebius storage bucket get-by-name --name "$BUCKET" --format jsonpath='{.metadata.id}'; }

case "${1:-}" in
  upload)
    nebius storage bucket get-by-name --name "$BUCKET" >/dev/null 2>&1 || nebius storage bucket create --name "$BUCKET"
    for f in common.py train.py eval_student.py job_entry.sh data/train.jsonl data/val.jsonl; do
      aws s3 cp "distill/$f" "s3://$BUCKET/distill/$(basename "$f")"
    done
    ;;
  train)
    nebius ai job create \
      --name "aloud-distill-$(date +%Y%m%d-%H%M)" \
      --subnet-id "$SUBNET_ID" \
      --image "$JOB_IMAGE" \
      --platform "$PLATFORM" \
      --preset "$PRESET" \
      --disk-size 200Gi \
      --timeout "$JOB_TIMEOUT" \
      --restart-policy never \
      --volume "$(bucket_id):/workspace/data" \
      --env "HF_HOME=/root/.cache/huggingface" \
      --container-command bash \
      --args "/workspace/data/distill/job_entry.sh"
    echo "Follow with: nebius ai job logs <job_ID> --follow"
    ;;
  serve)
    : "${FASTLANE_TOKEN:?Set FASTLANE_TOKEN (e.g. openssl rand -hex 32) and put the same value in .env}"
    nebius ai endpoint create \
      --name "$ENDPOINT" \
      --image "$VLLM_IMAGE" \
      --container-command "python3 -m vllm.entrypoints.openai.api_server" \
      --args "--model /models/out/latest/merged --served-model-name aloud-nano-4b --trust-remote-code --mamba_ssm_cache_dtype float32 --enable-auto-tool-choice --tool-call-parser qwen3_coder --max-model-len 4096 --host 0.0.0.0 --port 8000" \
      --volume "$(bucket_id):/models:ro" \
      --platform "$PLATFORM" \
      --preset "$PRESET" \
      --public \
      --container-port 8000 \
      --auth token \
      --token "$FASTLANE_TOKEN" \
      --shm-size 16Gi \
      --subnet-id "$SUBNET_ID"
    echo "URL: $(nebius ai endpoint get-by-name --name "$ENDPOINT" --format json | jq -r '.status.public_endpoints[] | select(startswith("https://"))')"
    ;;
  stop) nebius ai endpoint stop --id "$(nebius ai endpoint get-by-name --name "$ENDPOINT" --format jsonpath='{.metadata.id}')" ;;
  start) nebius ai endpoint start --id "$(nebius ai endpoint get-by-name --name "$ENDPOINT" --format jsonpath='{.metadata.id}')" ;;
  *) sed -n 2,10p "$0"; exit 1 ;;
esac
