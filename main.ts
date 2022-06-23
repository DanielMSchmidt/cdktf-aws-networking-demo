// Source: https://github.com/hashicorp/microservices-architecture-on-aws/tree/part-2
import * as cdktf from "cdktf";
import * as aws from "./.gen/providers/aws";

import { Construct } from "constructs";
import { App, Fn, TerraformOutput, TerraformStack, Token } from "cdktf";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    // Part 1
    const defaultTags = new cdktf.TerraformVariable(this, "default_tags", {
      default: {
        project: "cdktf-networking-demo",
      },

      description: "Map of default tags to apply to resources",
    });

    const region = "eu-central-1";
    const vpcCidr = new cdktf.TerraformVariable(this, "vpc_cidr", {
      default: "10.255.0.0/20",
      description: "CIDR block for VPC",
    });

    const projectName = Fn.lookup(
      Token.asStringMap(defaultTags.value),
      "project",
      ""
    );

    new aws.AwsProvider(this, "aws", {
      defaultTags: {
        tags: defaultTags.value,
      },
      region: region,
    });

    const awsEipNat = new aws.ec2.Eip(this, "nat", {
      tags: {
        Name: `${projectName}-nat-eip`,
      },
      vpc: true,
    });
    const awsVpcMain = new aws.vpc.Vpc(this, "main", {
      assignGeneratedIpv6CidrBlock: true,
      cidrBlock: vpcCidr.value,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      instanceTenancy: "default",
      tags: {
        Name: `${Fn.lookup(defaultTags.value, "project", "")}-vpc`,
      },
    });

    const availabilityZones = ["a", "b", "c"].map((zone) => `${region}${zone}`);

    const awsInternetGatewayGw = new aws.vpc.InternetGateway(this, "gw", {
      tags: {
        Name: `${projectName}-internet-gateway`,
      },
      vpcId: awsVpcMain.id,
    });
    const awsRouteTablePrivate = new aws.vpc.RouteTable(this, "private", {
      tags: {
        Name: `${projectName}-private-route-table`,
      },
      vpcId: awsVpcMain.id,
    });
    const awsRouteTablePublic = new aws.vpc.RouteTable(this, "public", {
      tags: {
        Name: `${projectName}-public-route-table`,
      },
      vpcId: awsVpcMain.id,
    });

    const publicSubnets = availabilityZones.map((az, index) => {
      return new aws.vpc.Subnet(this, "public_subnet_" + az, {
        assignIpv6AddressOnCreation: true,
        availabilityZone: az,
        cidrBlock: Fn.cidrsubnet(awsVpcMain.cidrBlock, 4, index),
        ipv6CidrBlock: Fn.cidrsubnet(awsVpcMain.ipv6CidrBlock, 8, index),
        mapPublicIpOnLaunch: true,
        tags: {
          Name: `${projectName}-public-${az}`,
        },
        vpcId: awsVpcMain.id,
      });
    });

    const privateSubnets = availabilityZones.map((az, index) => {
      return new aws.vpc.Subnet(this, "private_subnet_" + az, {
        availabilityZone: az,
        cidrBlock: Fn.cidrsubnet(
          awsVpcMain.cidrBlock,
          4,
          index + publicSubnets.length
        ),
        tags: {
          Name: `${projectName}-private-${az}`,
        },
        vpcId: awsVpcMain.id,
      });
    });

    const awsNatGatewayNat = new aws.vpc.NatGateway(this, "nat_14", {
      allocationId: awsEipNat.id,
      dependsOn: [awsEipNat, awsInternetGatewayGw],
      subnetId: publicSubnets[0].id,
      tags: {
        Name: `${projectName}-nat`,
      },
    });

    awsNatGatewayNat.overrideLogicalId("nat");
    new aws.vpc.Route(this, "private_internet_access", {
      destinationCidrBlock: "0.0.0.0/0",
      natGatewayId: awsNatGatewayNat.id,
      routeTableId: awsRouteTablePrivate.id,
    });
    new aws.vpc.Route(this, "public_internet_access", {
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: awsInternetGatewayGw.id,
      routeTableId: awsRouteTablePublic.id,
    });

    privateSubnets.forEach((subnet) => {
      new aws.vpc.RouteTableAssociation(
        this,
        `route_table_association_${subnet.availabilityZoneInput}`,
        {
          routeTableId: awsRouteTablePrivate.id,
          subnetId: subnet.id,
        }
      );
    });

    publicSubnets.forEach((subnet) => {
      new aws.vpc.RouteTableAssociation(
        this,
        `public_route_table_association_${subnet.availabilityZoneInput}`,
        {
          routeTableId: awsRouteTablePrivate.id,
          subnetId: subnet.id,
        }
      );
    });

    // Part 2
    const cluster = new aws.ecs.EcsCluster(this, "cluster", {
      name: `${projectName}-cluster`,
    });

    const lbGroup = new aws.elb.LbTargetGroup(this, "client_alb_targets", {
      namePrefix: "cl-",
      port: 9090,
      protocol: "HTTP",
      vpcId: awsVpcMain.id,
      deregistrationDelay: "30",
      targetType: "ip",

      healthCheck: {
        enabled: true,
        path: "/",
        healthyThreshold: 3,
        unhealthyThreshold: 3,
        timeout: 30,
        interval: 60,
        protocol: "HTTP",
      },

      tags: {
        Name: `${projectName}-client-tg`,
      },
    });

    const taskDefinition = new aws.ecs.EcsTaskDefinition(
      this,
      "task_definition",
      {
        family: `${projectName}-client`,
        memory: "512",
        cpu: "256",
        networkMode: "awsvpc",

        containerDefinitions: Fn.jsonencode([
          {
            name: "client",
            image: "nicholasjackson/fake-service:v0.23.1",
            cpu: 0,
            essential: true,

            portMappings: [
              {
                containerPort: 9090,
                hostPort: 9090,
                protocol: "tcp",
              },
            ],

            environment: [
              {
                name: "NAME",
                value: "client",
              },
              {
                name: "MESSAGE",
                value: "Hello World from the client!",
              },
            ],
          },
        ]),
      }
    );

    const clientAlbSG = new aws.vpc.SecurityGroup(
      this,
      "client_alb_security_group",
      {
        namePrefix: `${projectName}-ecs-client-alb`,
        description:
          "security group for client service application load balancer",
        vpcId: awsVpcMain.id,
      }
    );

    new aws.vpc.SecurityGroupRule(this, "client_alb_allow_80", {
      securityGroupId: clientAlbSG.id,
      type: "ingress",
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      ipv6CidrBlocks: ["::/0"],
      description: "Allow HTTP traffic",
    });

    new aws.vpc.SecurityGroupRule(this, "client_alb_allow_outbound", {
      securityGroupId: clientAlbSG.id,
      type: "egress",
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      ipv6CidrBlocks: ["::/0"],
      description: "Allow any outbound traffic",
    });

    const alb = new aws.elb.Alb(this, "client_alb", {
      namePrefix: "cl-",
      loadBalancerType: "application",
      securityGroups: [clientAlbSG.id],
      subnets: publicSubnets.map((subnet) => subnet.id),
      idleTimeout: 60,
      ipAddressType: "dualstack",
      tags: {
        Name: `${projectName}-client-alb`,
      },
    });
    new aws.elb.LbListener(this, "client_alb_http_80", {
      loadBalancerArn: alb.arn,
      port: 80,
      protocol: "HTTP",

      defaultAction: [
        {
          type: "forward",
          targetGroupArn: lbGroup.arn,
        },
      ],
    });

    const clientServiceSG = new aws.vpc.SecurityGroup(
      this,
      "ecs_client_service",
      {
        namePrefix: `${projectName}-ecs-client-service`,
        description: "ECS Client service security group.",
        vpcId: awsVpcMain.id,
      }
    );

    new aws.vpc.SecurityGroupRule(this, "ecs_client_service_allow_9090", {
      securityGroupId: clientServiceSG.id,
      type: "ingress",
      protocol: "tcp",
      fromPort: 9090,
      toPort: 9090,
      sourceSecurityGroupId: clientAlbSG.id,
      description:
        "Allow incoming traffic from the client ALB into the service container port",
    });

    new aws.vpc.SecurityGroupRule(
      this,
      "ecs_client_service_allow_inbound_self",
      {
        securityGroupId: clientServiceSG.id,
        type: "ingress",
        protocol: "-1",
        selfAttribute: true,
        fromPort: 0,
        toPort: 0,
        description: "Allow traffic from resources with this security group",
      }
    );

    new aws.vpc.SecurityGroupRule(this, "ecs_client_service_allow_outbound", {
      securityGroupId: clientServiceSG.id,
      type: "egress",
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      ipv6CidrBlocks: ["::/0"],
      description: "Allow any outbound traffic.",
    });

    new aws.ecs.EcsService(this, "client", {
      name: `${projectName}-client`,
      cluster: cluster.arn,
      taskDefinition: taskDefinition.arn,
      desiredCount: 1,
      launchType: "FARGATE",

      loadBalancer: [
        {
          targetGroupArn: lbGroup.arn,
          containerName: "client",
          containerPort: 9090,
        },
      ],

      networkConfiguration: {
        subnets: privateSubnets.map((sub) => sub.id),
        assignPublicIp: false,

        securityGroups: [clientServiceSG.id],
      },
    });

    new TerraformOutput(this, "client_alb_dns", {
      value: alb.dnsName,
      description: "DNS name of the AWS ALB for Client service",
    });
  }
}

const app = new App();
new MyStack(app, "cdktf-aws-networking-demo");
app.synth();
