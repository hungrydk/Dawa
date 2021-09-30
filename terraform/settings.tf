provider "aws" {
  region  = "eu-west-1"
}

terraform {
  backend "s3" {
    bucket = "aws-hungry-infrastructure-terraform"
    key    = "services/dawa"
    dynamodb_table = "aws-hungry-infrastructure-terraform"
    region = "eu-west-1"
    role_arn = "<THIS WILL BE REPLACED VIA terraform init -reconfigure -backend-config=role_arn=$terraform_backend_s3_role_arn>"
  }
}