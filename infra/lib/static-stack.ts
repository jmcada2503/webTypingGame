import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { FunctionUrl } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, CacheControl, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

interface StaticStackProps extends StackProps {
  apiUrl: FunctionUrl;
}

export class StaticStack extends Stack {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: StaticStackProps) {
    super(scope, id, props);

    const bucket = new Bucket(this, "Site", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    this.bucket = bucket;

    const api = FunctionUrlOrigin.withOriginAccessControl(props.apiUrl);

    // GET /api/online is the same for everyone, so CloudFront answers it for 30 s.
    const onlineCache = new CachePolicy(this, "OnlineCache", {
      defaultTtl: Duration.seconds(30),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(30),
      queryStringBehavior: CacheQueryStringBehavior.allowList("lang"),
      headerBehavior: CacheHeaderBehavior.none(),
      cookieBehavior: CacheCookieBehavior.none(),
    });

    const distribution = new Distribution(this, "Cdn", {
      // Until the real app entry exists, the site is the visual sandbox.
      defaultRootObject: "sandbox/index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: {
        // Order matters: the specific path before the /api/* catch-all.
        "/api/online*": {
          origin: api,
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: onlineCache,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/api/*": {
          origin: api,
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    this.distribution = distribution;

    // Vite hashes everything under assets/, so those never change: cache them for a year.
    const hashedAssets = new BucketDeployment(this, "HashedAssets", {
      sources: [Source.asset("../dist")],
      destinationBucket: bucket,
      exclude: ["*"],
      include: ["assets/*"],
      cacheControl: [CacheControl.fromString("public, max-age=31536000, immutable")],
      // Keep files other stacks and Lambdas write into the bucket (/status.json, /words/).
      prune: false,
    });

    // The HTML keeps its name between releases: browsers revalidate (cheap 304) and the
    // invalidation clears the edges. Runs after the assets so no page points at a missing file.
    const pages = new BucketDeployment(this, "Pages", {
      sources: [Source.asset("../dist")],
      destinationBucket: bucket,
      exclude: ["assets/*"],
      cacheControl: [CacheControl.noCache()],
      distribution,
      distributionPaths: ["/*"],
      prune: false,
    });
    pages.node.addDependency(hashedAssets);

    new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
