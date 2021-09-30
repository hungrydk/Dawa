accountname="aws-hungry-staging"
environment="Staging"
environment_short="Staging"

# Route 53
service_url="dawa.staging.aws.hungrycloud.net"

# Datasource
lookup_route53_hosted_zone_aws_dot_hungrycloud_dot_net="staging.aws.hungrycloud.net."
datasource_lookup_cloudwatch_alarm_to_slack="Staging-CloudWatchAlarmToSlack"

# ALB
alb_deregistration_delay = 5
alb_health_check_interval= 10
alb_health_check_healthy_threshold= 2
alb_health_check_unhealthy_threshold= 2

# CloudWatch
cloudwatch_log_group_retention_in_days=30
cloudwatch_metric_alarm_healthy_host_count_threshold="1"
cloudwatch_metric_alarm_running_task_count_threshold="1"

# ECS
ecs_service_desired_count=1
ecs_service_deployment_minimum_healthy_percent=100
ecs_service_deployment_maximum_percent=200
ecs_service_health_check_grace_period_seconds=10

# RDS
rds_skip_final_snapshot=true
rds_backup_retention_period=4
rds_scaling_auto_pause=true
rds_scaling_seconds_until_auto_pause=300
rds_scaling_min_capacity=2
rds_scaling_max_capacity=4

task_definition_cpu=1024
task_definition_memory=2048