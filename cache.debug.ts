const BASE_URL = "https://mainnet.auto-drive.autonomys.xyz/api/objects";

const cids = [
  "bafkr6ibgor76zkcn65qxe6af5jacldu7jrkvlyznl5d6shqi35t55sih2e",
  "bafkr6ihrmk4t4qqbcgeoivjjrdivjchqagqlt2lhn74zw7t2uo5xz4bgie",
  "bafkr6ibjiakbkjmkdlumaod3jnsjdec56au3f7pwb4ktwcbml3zqmfua3y",
  "bafkr6ib7nihupddcyyba3n3qgnjjp74t3wq75po4hz5c5q35bzdeioqes4",
  "bafkr6idls3m6febonnnsnvtkqnm27zcefdslxjllncaqv44qcqhzun3qyy",
  "bafkr6ihvz5vtrztbafdlqzqoz4jgky4fsravko4ddisg5r4lmuljxmbrji",
  "bafkr6iesvg7n6lgmnvqkxrjyunjcmht32vkjy5iilnqahmmihrlivps7ym",
  "bafkr6ihji2uoht7llzaedytalx3dgrwob74hohtutr7s45zyyjhbwycx44",
  "bafkr6ie4onkg7ifu7uetyqyvj4h7oxnvtad2o7t3ojihadxfroixm5vak4",
  "bafkr6igqbxrbmlh5qwnrmsiskrepfxcjdjq24v673cc5pbtvivtsv2zsdi",
  "bafkr6ibcu6u3puy2a43fz6yo7iac6pszmgop6wgyaxvrfas6p6pyqboxbu",
  "bafkr6ic67g7gawccgihdb4qhhirpb2odbo2pvsmgrykutpsi4qb5ofvitq",
  "bafkr6igbtskqntm5crr4danp6wkp4kkt4vgwufwfxxrwjiog4qiijkwfoi",
  "bafkr6ibvimzmvbx3l6ucq7cqdxq4inpvlytbxomk3h5z4mnjkiaig46ptm",
  "bafkr6ibkprz7jxtobff42o5upqc4fm7fz6eunckqtkggqvs7r6t53xbibu",
  "bafkr6ichaoc23fbxmvinxidsrzdtghhw3luxz6nujlfsqkum6qojzzyrdm",
  "bafkr6ifxis34r2teqa6lwakvxhna5vjzkftzewbzlnylh7qhngwb6vnvqe",
  "bafkr6ifk2hrivjebji5iramw6a7u72lhtqg65vjpnut7he2b7sciiegsmy",
  "bafkr6icygixm7xxqvzlwkkcubp2qh7gdt75hdmvvotlrybcsmzckhxedpu",
  "bafkr6ifuit6wrlulk4zoqrouittptblq7uywxzk33angjvo4crwbrr342q",
  "bafkr6iepy23wx7ocfsbinn734bzu3l5yq2u4v62zwtreomia6vekxlk35y",
  "bafkr6icb4fehkspbvzkcpdnxgksvll6lxqtehrwuwyag7hftu77etv3wku",
  "bafkr6ihs6wdchjebg2fxdyuo2eqmddcpvsvsievre7key3ubp3ulytyswe",
  "bafkr6ickbrj3bflyr6hmvfnfu7yyukmwkykntssamnzeurp76hm32apje4",
  "bafkr6idf77zs6xgllglnjp5eato3434dfxym6rg5j37gcbp2jj7z2jzh3u",
  "bafkr6ihx4nzlenehycic3ubrzkzybom6z4p2hihhw4bbb445ctrir6673q",
  "bafkr6ieui5kkywylsevbjwjbjrzbdge6gtvvsbv3aieuvr72a27a4eipna",
  "bafkr6igptiwuckjwwz4ui4pvblkrek2tldkzieju2gse5mb4fqzyhsxwim",
  "bafkr6igtylcmgcvzhezmulwng6p3dgzrjxz4qkwsoc2bkur34r52gtsdei",
  "bafkr6ifjldgwybg3d5whdegvxod7ynnm3qdcel6gby34o3nnzhryllr6wa",
  "bafkr6ia4lutadd4t2is7mmmgkkfmblpepczsebw6qnwjbq7p2ulzr6emsa",
  "bafkr6ify5kaoeh7jiooeiq24bhvfs6gxxdatihendngxj4xurbmxn37izu",
  "bafkr6ifckvafnbmmz37tccpz3rd4mz6s5dbyz6ckynphlhx6k5y6rignqy",
  "bafkr6ia4d3s6vpaojjlwag7il2p6tt3kgujxfxg45ih7gjkty4cuzmdl6q",
  "bafkr6ibczwb3f6pwmkm5ylm2kwlixv5x4dmcbo77bjf7fsvx7qfzh2i46y",
  "bafkr6iebyr6shyb62euq5mohylyocbete6lb3potpd6souplw73avgxwrq",
  "bafkr6iguwo5hj3hjixm36i24vspcm7frxnwmluccu3xwmmvvs27mmbao74",
  "bafkr6ihy2dyju7b7tv43uwnahothiqmls4auy6zk5goqjsasovi4mopp5e",
  "bafkr6ieaxcnqkixj3iqu237sicdi7srmubzuibuukv2c2lulq27rjhw3ai",
  "bafkr6iem6pebgjrsin2z7ofusxll3iyeq6fvngc7ygrr3bwyp6dhcxidh4",
  "bafkr6ig576ejfnlflvsgcqwi7quwr2neq5korroshif4hnbuwk3qdrnpju",
  "bafkr6ihesafhmkmcrwjwpuhfqmmkjioavt2w3lfrv3pkgshtjr4oawiude",
  "bafkr6id2vvqe4a7urnt3ha62dh6u543pe6mxxwerk5zipmimauj5ozawsm",
  "bafkr6iccf23dxd4sjikzplkh2rpommjuguzjgqnbxh77budypyrdh7m2oi",
  "bafkr6igt775cx5eus77urwvlqf3dxwzjjh2chzcmknmc42tycydp6tnlqq",
  "bafkr6ifccp3nozppt74wkiluhx5ed5ggqfmbgvobnnuzwijvf3r5ne5m74",
  "bafkr6ibkeolp6jxtzzhyqj65twolh64l4wchemkowqbqyyhav253fyxr5q",
  "bafkr6ih7wcc7hnc7rol6pa5ok626bydxzlrwx6dtzjiuqq6phzcuyr3jzq",
  "bafkr6if7bjyhxufkar7sq5xal4sp7bjomsvpdcz2bh3is4kt2n53gazd24",
  "bafkr6ierhh7rezyrpenyi3v3milj4n7wxbmhz3hdmqk7q7dgfgwwktyham",
  "bafkr6ibthdttmf6jjc5pj5wz64sel5zcztdzbpkntvfs3yir37n4thjgl4",
  "bafkr6iahtm4qol5egxcjpm6pmrj7zcelho2fxk6hlwthde2fr7dhm2qyby",
  "bafkr6iepn2dm36et5coxo44r6vtqkyxnrjcwmkn7nnwwvijjowbpj4mely",
  "bafkr6ifcumi7mbxta6tf4c6cypizevns2gaaakbicjipwio3n6sg4ezliq",
];

interface ObjectInformation {
  cid: string;
  metadata: {
    name: string;
    type: string;
    chunks: Array<{
      cid: string;
      size: string;
    }>;
    dataCid: string;
    mimeType: string;
    totalSize: string;
    totalChunks: number;
    uploadOptions: {
      encryption: {
        algorithm: string;
      };
      compression: {
        algorithm: string;
      };
    };
  };
  tags: string[] | null;
  uploadState: {
    uploadedNodes: number;
    totalNodes: number;
    archivedNodes: number;
    minimumBlockDepth: number | null;
    maximumBlockDepth: number | null;
  };
  owners: Array<{
    oauthProvider: string;
    oauthUserId: string;
    role: string;
  }>;
  status: string;
  publishedObjectId: string | null;
  createdAt: string;
}

const fetchObjectInformation = async (cid: string) => {
  const response = await fetch(`${BASE_URL}/${cid}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch object information: ${response.statusText}`
    );
  }
  const data = await response.json();
  console.log(data);
  return data as ObjectInformation;
};

const main = async () => {
  const result: string[] = [];
  for (const cid of cids) {
    console.log(`Fetching ${cid} info`);
    const data = await fetchObjectInformation(cid);
    const isEncrypted = !!data.metadata.uploadOptions?.encryption?.algorithm;
    if (isEncrypted) {
      result.push(data.cid);
    }
  }
  console.log(result);
};

main();
