import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  Function as CdnFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AaaaRecord, ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import type { FunctionUrl } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, CacheControl, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

/** The game's own domain, registered in Route 53 (its hosted zone came with the registration). */
const DOMAIN = "typewing.net";
const WWW = `www.${DOMAIN}`;
const ZONE_ID = "Z02230451DTTTY9A30LCV";

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

    const zone = HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: ZONE_ID, zoneName: DOMAIN });
    // CloudFront only reads certificates from us-east-1, which is where this stack lives.
    const certificate = new Certificate(this, "Cert", {
      domainName: DOMAIN,
      subjectAlternativeNames: [WWW],
      validation: CertificateValidation.fromDns(zone),
    });

    // Only typewing.net serves the game: www and the *.cloudfront.net address redirect to it (301).
    const toApex = new CdnFunction(this, "ToApex", {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(`function handler(event) {
  var r = event.request;
  if (r.headers.host.value === "${DOMAIN}") return r;
  var qs = Object.keys(r.querystring).map(function (k) {
    var q = r.querystring[k];
    return q.value === "" ? k : k + "=" + q.value;
  }).join("&");
  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: { location: { value: "https://${DOMAIN}" + r.uri + (qs ? "?" + qs : "") } },
  };
}`),
    });

    const functionAssociations = [{ function: toApex, eventType: FunctionEventType.VIEWER_REQUEST }];

    const distribution = new Distribution(this, "Cdn", {
      domainNames: [DOMAIN, WWW],
      certificate,
      // The game is at /; the visual sandbox stays reachable at /sandbox/.
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations,
      },
      additionalBehaviors: {
        // Order matters: the specific path before the /api/* catch-all.
        "/api/online*": {
          origin: api,
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: onlineCache,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations,
        },
        "/api/*": {
          origin: api,
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations,
        },
      },
    });
    this.distribution = distribution;

    for (const recordName of [undefined, "www"]) {
      const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
      new ARecord(this, `A${recordName ?? "Apex"}`, { zone, recordName, target });
      new AaaaRecord(this, `Aaaa${recordName ?? "Apex"}`, { zone, recordName, target });
    }

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

    new CfnOutput(this, "SiteUrl", { value: `https://${DOMAIN}` });
  }
}
