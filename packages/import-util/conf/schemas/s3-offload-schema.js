module.exports = {
  s3_offload: {
    s3: {
      endpoint: {
        format: 'string',
        default: null,
        doc: 'AWS endpoint. I prod sættes AWS endpoint ud fra region, så i prod skal endpoint være null.'
      },
      force_path_style: {
        format: 'boolean',
        doc: 'Anvend "path style" for S3 stier. skal være false i prod - anvendes kun til test.',
        default: false
      },
      region: {
        default: 'eu-west-1',
        format: 'string',
        doc: 'AWS region'
      },
      access_key_id: {
        format: 'string',
        doc: 'AWS Access key ID',
        default: null
      },
      secret_access_key: {
        format: 'string',
        sensitive: true,
        doc: 'AWS secret access key',
        default: null
      }
    },
    bucket: {
      format: 'string',
      doc: 'S3 bucket',
      required: true,
      default: null
    },
    key_prefix: {
      format: 'string',
      doc: 'Præfix som tilføjes blob-ID. Bør inkludere miljøets navn, e.g. p2.',
      required: true,
      default: null
    },
    path: {
      format: 'string',
      doc: 'Stien i S3 hvor LOBs gemmes. Skal være ens på alle miljøer.',
      default: 'blob'
    },
    threshold: {
      format: 'nat',
      default: 8192,
      doc: 'Angiver grænsen for hvor store LOBs skal være før de offloades til S3.'
    }
  }
};
