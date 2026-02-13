#!/usr/bin/env bash
set -euo pipefail

REGION="ap-east-1"
INDEXER_ASG="filing-etl-prod-quickwit-indexer"
SEARCHER_ASG="filing-etl-prod-quickwit-searcher"

usage() {
  echo "Usage: $0 {start|stop|status}"
  exit 1
}

[ $# -eq 1 ] || usage

case "$1" in
  start)
    echo "Starting Quickwit cluster..."
    aws autoscaling update-auto-scaling-group \
      --auto-scaling-group-name "$INDEXER_ASG" \
      --min-size 1 --desired-capacity 1 --region "$REGION"
    aws autoscaling update-auto-scaling-group \
      --auto-scaling-group-name "$SEARCHER_ASG" \
      --min-size 1 --desired-capacity 1 --region "$REGION"
    echo "Both ASGs set to desired=1. Instances will launch shortly."
    ;;
  stop)
    echo "Stopping Quickwit cluster..."
    aws autoscaling update-auto-scaling-group \
      --auto-scaling-group-name "$INDEXER_ASG" \
      --min-size 0 --desired-capacity 0 --region "$REGION"
    aws autoscaling update-auto-scaling-group \
      --auto-scaling-group-name "$SEARCHER_ASG" \
      --min-size 0 --desired-capacity 0 --region "$REGION"
    echo "Both ASGs set to desired=0. Instances will terminate shortly."
    ;;
  status)
    for asg in "$INDEXER_ASG" "$SEARCHER_ASG"; do
      echo "=== $asg ==="
      aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names "$asg" --region "$REGION" \
        --query 'AutoScalingGroups[0].{Min:MinSize,Desired:DesiredCapacity,Max:MaxSize,Instances:Instances[*].{Id:InstanceId,State:LifecycleState}}' \
        --output table
    done
    ;;
  *)
    usage
    ;;
esac
