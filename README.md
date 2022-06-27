# CDKTF Networking Demo for AWS

This is a port of parts 1 and 2 from [hashicorp/microservices-architecture-on-aws](https://github.com/hashicorp/microservices-architecture-on-aws/tree/part-2), adapted for CDKTF.

## Summary

- [Part 1: Port of the Terraform Code](https://github.com/DanielMSchmidt/cdktf-aws-networking-demo/tree/part-1)
- [Part 2: Refactoring into Constructs](https://github.com/DanielMSchmidt/cdktf-aws-networking-demo/tree/part-2)

## The Architecture

We implement roughly this architecture:

![Architecture](https://github.com/hashicorp/microservices-architecture-on-aws/raw/main/images/aws-consul-ecs-finalized-architecture.png)

We create a VPC with private and public subnets and use a gateway to expose traffic from our ECS cluster to the internet.

## Getting started

To run this demo, you need to have the following:

- Terraform >= 1.0.0
- Node.js >= 12
- cdktf-cli 0.11.2 (can be installed via `npm install -g cdktf-cli@0.11.2`)
- [Credentials to AWS set up in your environment](https://github.com/hashicorp/microservices-architecture-on-aws#prerequisites)

Run the following command to get started:

- `npm install` to install all dependencies
- `cdktf deploy cdktf-aws-networking-demo` to deploy the demo

## Walkthrough

This walkthrough should give you a high level overview of CDKTF, especially coming from the AWS CDK or Terraform. For more in-depth information, please refer to the [Terraform CDK documentation](https://www.terraform.io/cdktf).

### Coming from Terraform

CDKTF does not come with it's own language but works with a few imperative programming languages instead: Typescript, Python, Java, C#, Go. Instead of variable / output / resource / data source blocks a CDKTF program consists of Constructs. [Constructs](https://github.com/aws/constructs) is a framework to build a graph that builds the desired state. CDKTF takes this graph and builds Terraform code from it. The Constructs you can use in CDKTF programs come from the CDKTF core library, third party packages, or are generated bindings based on the Terraform Provider schema. You can use Constructs [to build logical components, see part 2](https://github.com/DanielMSchmidt/cdktf-aws-networking-demo/tree/part-2). To instanciate a Construct you have to pass the scope (which is the parent), a unique identifier within this scope, and whatever properties this specific Construct requires.

A special construct is the `TerraformStack`, which maps roughly to a Terraform workspace. CDKTF can handle multiple stacks and even build connections between them automatically; they are resolved through `RemoteStateDataSources` and we call them [Cross Stack References](https://www.terraform.io/cdktf/concepts/stacks#cross-stack-references). The CDKTF CLI can be used to deploy / destroy multiple in parallel.

### Coming from AWS CDK

The concept of AWS CDK and CDKTF is very similar. The main difference is that CDKTF synthesizes the code into Terraform instead of CloudFormation, meaning CDKTF can be used to build infrastructure on any platform with a Terraform provider. Since we have a much broader spectrum of things to support we have only few L2 / L3 constructs in place. Instead we focus much more on making the generated L1 constructs great and provide a good UX that way. We also work on an [AWS CDK Adapter](https://www.terraform.io/cdktf/create-and-deploy/aws-adapter) that lets you use AWS CDK Constructs within your CDKTF program seemlessly, it's currently in technical preview.

### Provider bindings

In line 2 you can see we are importing the AWS provider. We are using a pre-built provider here, these are a set of providers we generate and publish bindings for. [You can use any provider you want with CDKTF](https://www.terraform.io/cdktf/concepts/providers-and-resources#add-provider-to-cdktf-json), if you can we recommend using pre-built ones since it saves you some time. You can use the new `cdktf provider add` command to add the provider of your choice, it will find it either as a pre-built one or it will be added to your `cdktf.json` file.

The generated bindings are what is often referred to as L1 Constructs, so basic generated abstractions. We recommend wrapping your L1 constructs in a L2 construct, we will cover this in the [second part](https://github.com/danielmschmidt/cdktf-aws-networking-demo/tree/part-2).

You can also use the [AWS Adapter (technical preview)](https://github.com/hashicorp/cdktf-aws-cdk) to use the AWS CDK within CDKTF, we will go through this in the [third part](https://github.com/danielmschmidt/cdktf-aws-networking-demo/tree/part-3).

You will notice the generated bindings follow a naming convention, for example the `aws_ecs_cluster` binding is named `ecsCluster`. There are a few exceptions when the name would collide with a value in a programming language we support, but in general it's quite predictable. We represent blocks as objects if they can only appear once, as lists of objects if there can be more.

### Note on the AWS provider namespacing

Since AWS provides so many services the provider is quite big, this is why it's the only provider we currently namespace. The namespaces are determined by the [sidebar group the resource is in](https://registry.terraform.io/providers/hashicorp/aws/latest/docs).

### Behind the scenes

[The Deep Dive into CDK for Terraform](https://www.youtube.com/watch?v=nNr8JrN-9HE&t=2s) is a good talk to watch to understand the inner workings of CDKTF.
Here is the workflow when you run `cdktf deploy cdktf-aws-networking-demo` as a quick TL;DR overview:

1. Synth: We run the app command from your `cdktf.json` file, this will generate the `cdktf.out` directory with the synthesized code. The code consists of a `manifest.json` that has all the stack metadata in it, e.g. dependencies between stacks. The `cdk.tf.json` file is the actual Terraform code that is being synthesized per stack. This phase is the synth phase, everything else is part of the execution phase.
2. `terraform init` is run in the selected stack to download the actual providers
3. `terraform plan` is run in the selected stack to generate the plan, it is shown to you through the CLI output
4. `terraform apply` is run in the selected stack to apply the plan

### Converting from Terraform to CDKTF

To help people convert documentation or their code base over to CDKTF, we have the [`cdktf convert`](https://www.terraform.io/cdktf/cli-reference/commands#convert) command. It will convert your Terraform code to CDKTF code. There might be some differences in the generated code, but most of the time it should be pretty close.

### Refactoring into Constructs

The Terraform CDK does not come with a lot of built-in constructs, so we need to create our own.
Users can create abstractions for their own use-cases using `Constructs` and be creative in their structure. The can use methods / closures / constructors to create their own constructs and configure behaviour.

Constructs can be used internally through file references, but they can also be distributed. [You can use the CDKTF projen construct](https://github.com/projen/projen/blob/main/src/cdktf/cdktf-construct.ts#L28) to generate a GitHub project for distributing your own CDKTF constructs. If you want to share your code both as constructs and as Terraform Modules you should take a look at [`https://github.com/DanielMSchmidt/projen-cdktf-hybrid-construct/`](https://github.com/DanielMSchmidt/projen-cdktf-hybrid-construct/), there is also a [CDK Day talk about it](https://www.youtube.com/watch?v=s8tO-ymVQPg&t=10267s).
