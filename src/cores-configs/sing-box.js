import { getConfigAddresses, extractWireguardParams, generateRemark, randomUpperCase, getRandomPath, isIPv6, isDomain, base64ToDecimal, getDomain } from './helpers';
import { getDataset } from '../kv/handlers';

async function buildSingBoxDNS(isWarp) {
    const isIPv6 = (VLTRenableIPv6 && !isWarp) || (warpEnableIPv6 && isWarp);
    const servers = [
        {
            type: isWarp ? "udp" : "https",
            server: isWarp ? "1.1.1.1" : dohHost.host,
            server_port: isWarp ? 53 : 443,
            detour: "✅ Selector",
            tag: "dns-remote"
        },
    ];

    const addDnsServer = (type, server, server_port, detour, tag, domain_resolver) => servers.push({
        type,
        ...(server && { server }),
        ...(server_port && { server_port }),
        ...(detour && { detour }),
        ...(domain_resolver && {
            domain_resolver: {
                server: domain_resolver,
                strategy: isIPv6 ? "prefer_ipv4" : "ipv4_only"
            }
        }),
        tag
    });

    if (localDNS === 'localhost') {
        addDnsServer("local", null, null, null, "dns-direct");
    } else {
        addDnsServer("udp", localDNS, 53, null, "dns-direct");
    }

    const dnsHost = getDomain(antiSanctionDNS);
    if (dnsHost.isHostDomain) {
        addDnsServer("https", dnsHost.host, 443, null, "dns-anti-sanction", "dns-direct");
    } else {
        addDnsServer("udp", antiSanctionDNS, 53, null, "dns-anti-sanction", null);
    }

    const rules = [
        {
            domain: [
                "raw.githubusercontent.com",
                "time.apple.com"
            ],
            server: "dns-direct"
        },
        {
            clash_mode: "Direct",
            server: "dns-direct"
        },
        {
            clash_mode: "Global",
            server: "dns-remote"
        }
    ];

    if (dohHost.isDomain && !isWarp) {
        const { ipv4, ipv6, host } = dohHost;
        const answers = [
            ...ipv4.map(ip => `${host}. IN A ${ip}`),
            ...(VLTRenableIPv6 ? ipv6.map(ip => `${host}. IN AAAA ${ip}`) : [])
        ];

        rules.unshift({
            domain: host,
            action: "predefined",
            answer: answers
        });
    }

    const addDnsRule = (geosite, geoip, domain, dns) => {
        let type, mode;
        const ruleSets = [];
        if (geoip) {
            mode = 'and';
            type = 'logical';
            ruleSets.push({ rule_set: geosite }, { rule_set: geoip });
        }
        const action = dns === 'reject' ? 'reject' : 'route';
        const server = dns === 'reject' ? null : dns;

        rules.push({
            ...(type && { type }),
            ...(mode && { mode }),
            ...(ruleSets.length && { rules: ruleSets }),
            ...(geosite && !geoip && { rule_set: geosite }),
            ...(domain && { domain_suffix: domain }),
            action,
            ...(server && { server })
        });
    }

    const routingRules = [
        { rule: true, action: 'reject', geosite: "geosite-malware", dns: "reject" },
        { rule: true, action: 'reject', geosite: "geosite-phishing", dns: "reject" },
        { rule: true, action: 'reject', geosite: "geosite-cryptominers", dns: "reject" },
        { rule: blockAds, action: 'reject', geosite: "geosite-category-ads-all", dns: "reject" },
        { rule: blockPorn, action: 'reject', geosite: "geosite-nsfw", dns: "reject" },
        { rule: bypassIran, geosite: "geosite-ir", geoip: "geoip-ir", dns: "dns-direct" },
        { rule: bypassChina, geosite: "geosite-cn", geoip: "geoip-cn", dns: "dns-direct" },
        { rule: bypassRussia, geosite: "geosite-category-ru", geoip: "geoip-ru", dns: "dns-direct" },
        { rule: bypassOpenAi, geosite: "geosite-openai", dns: "dns-anti-sanction" },
        { rule: bypassGoogle, geosite: "geosite-google", dns: "dns-anti-sanction" },
        { rule: bypassMicrosoft, geosite: "geosite-microsoft", dns: "dns-anti-sanction" }
    ];

    customBlockRules.forEach(value => {
        isDomain(value) && routingRules.unshift({ rule: true, domain: value, dns: 'reject' });
    });

    customBypassRules.forEach(value => {
        isDomain(value) && routingRules.push({ rule: true, domain: value, dns: "dns-direct" });
    });

    customBypassSanctionRules.forEach(value => {
        isDomain(value) && routingRules.push({ rule: true, domain: value, dns: "dns-anti-sanction" });
    });

    const groupedRules = new Map();
    routingRules.forEach(({ rule, geosite, geoip, domain, dns }) => {
        if (!rule) return;
        if (geosite && geoip && dns !== 'reject') {
            addDnsRule(geosite, geoip, null, dns);
        } else {
            !groupedRules.has(dns) && groupedRules.set(dns, { geosite: [], domain: [] });
            geosite && groupedRules.get(dns).geosite.push(geosite);
            domain && groupedRules.get(dns).domain.push(domain);
        }
    });

    for (const [dns, rule] of groupedRules) {
        const { geosite, domain } = rule;
        if (domain.length) addDnsRule(null, null, domain, dns);
        if (geosite.length) addDnsRule(geosite, null, null, dns);
    }

    const isFakeDNS = (VLTRFakeDNS && !isWarp) || (warpFakeDNS && isWarp);
    if (isFakeDNS) {
        const fakeip = {
            type: "fakeip",
            tag: "dns-fake",
            inet4_range: "198.18.0.0/15"
        };

        if (isIPv6) fakeip.inet6_range = "fc00::/18";
        servers.push(fakeip);

        rules.push({
            disable_cache: true,
            inbound: "tun-in",
            query_type: [
                "A",
                "AAAA"
            ],
            server: "dns-fake"
        });
    }

    return {
        servers,
        rules,
        strategy: isIPv6 ? "prefer_ipv4" : "ipv4_only",
        independent_cache: true
    }
}

function buildSingBoxRoutingRules(isWarp) {
    const rules = [
        {
            action: "sniff"
        },
        {
            action: "hijack-dns",
            mode: "or",
            rules: [
                { inbound: "dns-in" },
                { port: 53 },
                { protocol: "dns" }
            ],
            type: "logical"
        },
        {
            clash_mode: "Direct",
            outbound: "direct"
        },
        {
            clash_mode: "Global",
            outbound: "✅ Selector"
        }
    ];

    const addRoutingRule = (domain, ip, geosite, geoip, network, protocol, port, type) => {
        const action = type === 'block' ? 'reject' : 'route';
        const outbound = type === 'direct' ? 'direct' : null;
        rules.push({
            ...(geosite && { rule_set: geosite }),
            ...(geoip && { rule_set: geoip }),
            ...(domain && { domain_suffix: domain }),
            ...(ip && { ip_cidr: ip }),
            ...(network && { network }),
            ...(protocol && { protocol }),
            ...(port && { port }),
            action,
            ...(outbound && { outbound })
        });
    }

    isWarp && blockUDP443 && addRoutingRule(null, null, null, null, "udp", "quic", 443, 'block');
    !isWarp && addRoutingRule(null, null, null, null, "udp", null, null, 'block');

    const routingRules = [
        {
            rule: true,
            type: 'block',
            geosite: "geosite-malware",
            geoip: "geoip-malware",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-malware.srs",
            geoipURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-malware.srs"
        },
        {
            rule: true,
            type: 'block',
            geosite: "geosite-phishing",
            geoip: "geoip-phishing",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-phishing.srs",
            geoipURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-phishing.srs"
        },
        {
            rule: true,
            type: 'block',
            geosite: "geosite-cryptominers",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-cryptominers.srs",
        },
        {
            rule: blockAds,
            type: 'block',
            geosite: "geosite-category-ads-all",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-category-ads-all.srs",
        },
        {
            rule: blockPorn,
            type: 'block',
            geosite: "geosite-nsfw",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-nsfw.srs",
        },
        {
            rule: bypassIran,
            type: 'direct',
            geosite: "geosite-ir",
            geoip: "geoip-ir",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-ir.srs",
            geoipURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-ir.srs"
        },
        {
            rule: bypassChina,
            type: 'direct',
            geosite: "geosite-cn",
            geoip: "geoip-cn",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-cn.srs",
            geoipURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-cn.srs"
        },
        {
            rule: bypassRussia,
            type: 'direct',
            geosite: "geosite-category-ru",
            geoip: "geoip-ru",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-category-ru.srs",
            geoipURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-ru.srs"
        },
        {
            rule: bypassOpenAi,
            type: 'direct',
            geosite: "geosite-openai",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-openai.srs"
        },
        {
            rule: bypassGoogle,
            type: 'direct',
            geosite: "geosite-google",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-google.srs"
        },
        {
            rule: bypassMicrosoft,
            type: 'direct',
            geosite: "geosite-microsoft",
            geositeURL: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-microsoft.srs"
        }
    ];

    customBlockRules.forEach(value => {
        const isDomainValue = isDomain(value);
        routingRules.push({
            rule: true,
            type: 'block',
            domain: isDomainValue ? `domain:${value}` : null,
            ip: isDomainValue ? null : isIPv6(value) ? value.replace(/\[|\]/g, '') : value
        });
    });

    [...customBypassRules, ...customBypassSanctionRules].forEach(value => {
        const isDomainValue = isDomain(value);
        routingRules.push({
            rule: true,
            type: 'direct',
            domain: isDomainValue ? `domain:${value}` : null,
            ip: isDomainValue ? null : isIPv6(value) ? value.replace(/\[|\]/g, '') : value
        });
    });


    const ruleSets = [];
    const addRuleSet = (geoRule) => {
        const { geosite, geositeURL, geoip, geoipURL } = geoRule;
        geosite && ruleSets.push({
            type: "remote",
            tag: geosite,
            format: "binary",
            url: geositeURL,
            download_detour: "direct"
        });

        geoip && ruleSets.push({
            type: "remote",
            tag: geoip,
            format: "binary",
            url: geoipURL,
            download_detour: "direct"
        });
    }

    const groupedRules = new Map();
    routingRules.forEach(routingRule => {
        const { rule, type, domain, ip, geosite, geoip } = routingRule;
        if (!rule) return;
        !groupedRules.has(type) && groupedRules.set(type, { domain: [], ip: [], geosite: [], geoip: [] });
        domain && groupedRules.get(type).domain.push(domain);
        ip && groupedRules.get(type).ip.push(ip);
        geosite && groupedRules.get(type).geosite.push(geosite);
        geoip && groupedRules.get(type).geoip.push(geoip);
        if (geosite || geoip) addRuleSet(routingRule);
    });

    for (const [type, rule] of groupedRules) {
        const { domain, ip, geosite, geoip } = rule;

        if (domain.length) addRoutingRule(domain, null, null, null, null, null, null, type);
        if (geosite.length) addRoutingRule(null, null, geosite, null, null, null, null, type);
        if (ip.length) addRoutingRule(null, ip, null, null, null, null, null, type);
        if (geoip.length) addRoutingRule(null, null, null, geoip, null, null, null, type);
    }

    bypassLAN && rules.push({
        ip_is_private: true,
        outbound: "direct"
    });

    return {
        rules,
        rule_set: ruleSets,
        auto_detect_interface: true,
        override_android_vpn: true,
        final: "✅ Selector"
    }
}

function buildSingBoxVLOutbound(remark, address, port, host, sni, allowInsecure) {
    const path = `/${getRandomPath(16)}${proxyIPs.length ? `/${btoa(proxyIPs.join(','))}` : ''}`;
    const tls = defaultHttpsPorts.includes(port) ? true : false;

    const outbound = {
        tag: remark,
        type: "vless",
        server: address,
        server_port: +port,
        uuid: userID,
        packet_encoding: "",
        transport: {
            early_data_header_name: "Sec-WebSocket-Protocol",
            max_early_data: 2560,
            headers: {
                Host: host
            },
            path: path,
            type: "ws"
        },
        domain_resolver: {
            server: "dns-direct",
            strategy: VLTRenableIPv6 ? "prefer_ipv4" : "ipv4_only",
            rewrite_ttl: 60
        },
        tcp_fast_open: true,
        tcp_multi_path: true
    };

    if (tls) outbound.tls = {
        alpn: "http/1.1",
        enabled: true,
        insecure: allowInsecure,
        server_name: sni,
        utls: {
            enabled: true,
            fingerprint: "randomized"
        }
    };

    return outbound;
}

function buildSingBoxTROutbound(remark, address, port, host, sni, allowInsecure) {
    const path = `/tr${getRandomPath(16)}${proxyIPs.length ? `/${btoa(proxyIPs.join(','))}` : ''}`;
    const tls = defaultHttpsPorts.includes(port) ? true : false;

    const outbound = {
        tag: remark,
        type: "trojan",
        password: TRPassword,
        server: address,
        server_port: +port,
        transport: {
            early_data_header_name: "Sec-WebSocket-Protocol",
            max_early_data: 2560,
            headers: {
                Host: host
            },
            path: path,
            type: "ws"
        },
        domain_resolver: {
            server: "dns-direct",
            strategy: VLTRenableIPv6 ? "prefer_ipv4" : "ipv4_only",
            rewrite_ttl: 60
        },
        tcp_fast_open: true,
        tcp_multi_path: true
    }

    if (tls) outbound.tls = {
        alpn: "http/1.1",
        enabled: true,
        insecure: allowInsecure,
        server_name: sni,
        utls: {
            enabled: true,
            fingerprint: "randomized"
        }
    };

    return outbound;
}

function buildSingBoxWarpOutbound(warpConfigs, remark, endpoint, chain) {
    const ipv6Regex = /\[(.*?)\]/;
    const portRegex = /[^:]*$/;
    const endpointServer = endpoint.includes('[') ? endpoint.match(ipv6Regex)[1] : endpoint.split(':')[0];
    const endpointPort = endpoint.includes('[') ? +endpoint.match(portRegex)[0] : +endpoint.split(':')[1];
    const server = chain ? "162.159.192.1" : endpointServer;
    const port = chain ? 2408 : endpointPort;

    const {
        warpIPv6,
        reserved,
        publicKey,
        privateKey
    } = extractWireguardParams(warpConfigs, chain);

    const outbound = {
        tag: remark,
        type: "wireguard",
        address: [
            "172.16.0.2/32",
            warpIPv6
        ],
        mtu: 1280,
        peers: [
            {
                address: server,
                port: port,
                public_key: publicKey,
                reserved: base64ToDecimal(reserved),
                allowed_ips: [
                    "0.0.0.0/0",
                    "::/0"
                ],
                persistent_keepalive_interval: 5
            }
        ],
        private_key: privateKey,
        domain_resolver: {
            server: chain ? "dns-remote" : "dns-direct",
            strategy: warpEnableIPv6 ? "prefer_ipv4" : "ipv4_only",
            rewrite_ttl: 60
        }
    };

    if (chain) outbound.detour = chain;
    return outbound;
}

function buildSingBoxChainOutbound(chainProxyParams) {
    if (["socks", "http"].includes(chainProxyParams.protocol)) {
        const { protocol, server, port, user, pass } = chainProxyParams;

        const chainOutbound = {
            type: protocol,
            tag: "",
            server: server,
            server_port: +port,
            username: user,
            password: pass,
            domain_resolver: {
                server: "dns-remote",
                strategy: VLTRenableIPv6 ? "prefer_ipv4" : "ipv4_only",
                rewrite_ttl: 60
            },
            detour: ""
        };

        if (protocol === 'socks') chainOutbound.version = "5";
        return chainOutbound;
    }

    const { server, port, uuid, flow, security, type, sni, fp, alpn, pbk, sid, headerType, host, path, serviceName } = chainProxyParams;
    const chainOutbound = {
        type: "vless",
        tag: "",
        server: server,
        server_port: +port,
        uuid: uuid,
        flow: flow,
        domain_resolver: {
            server: "dns-remote",
            strategy: VLTRenableIPv6 ? "prefer_ipv4" : "ipv4_only",
            rewrite_ttl: 60
        },
        detour: ""
    };

    if (security === 'tls' || security === 'reality') {
        const tlsAlpns = alpn ? alpn?.split(',').filter(value => value !== 'h2') : [];
        chainOutbound.tls = {
            enabled: true,
            server_name: sni,
            insecure: false,
            alpn: tlsAlpns,
            utls: {
                enabled: true,
                fingerprint: fp
            }
        };

        if (security === 'reality') {
            chainOutbound.tls.reality = {
                enabled: true,
                public_key: pbk,
                short_id: sid
            };

            delete chainOutbound.tls.alpn;
        }
    }

    if (headerType === 'http') {
        const httpHosts = host?.split(',');
        chainOutbound.transport = {
            type: "http",
            host: httpHosts,
            path: path,
            method: "GET",
            headers: {
                "Connection": ["keep-alive"],
                "Content-Type": ["application/octet-stream"]
            },
        };
    }

    if (type === 'ws') {
        const wsPath = path?.split('?ed=')[0];
        const earlyData = +path?.split('?ed=')[1] || 0;
        chainOutbound.transport = {
            type: "ws",
            path: wsPath,
            headers: { Host: host },
            max_early_data: earlyData,
            early_data_header_name: "Sec-WebSocket-Protocol"
        };
    }

    if (type === 'grpc') chainOutbound.transport = {
        type: "grpc",
        service_name: serviceName
    };

    return chainOutbound;
}

async function buildSingBoxConfig(selectorTags, urlTestTags, secondUrlTestTags, isWarp) {
    const config = structuredClone(singboxConfigTemp);
    config.dns = await buildSingBoxDNS(isWarp);
    config.route = buildSingBoxRoutingRules(isWarp);

    const selector = {
        type: "selector",
        tag: "✅ Selector",
        outbounds: selectorTags
    };

    const urlTest = {
        type: "urltest",
        tag: isWarp ? `💦 Warp - Best Ping 🚀` : '💦 Best Ping 💥',
        outbounds: urlTestTags,
        url: "https://www.gstatic.com/generate_204",
        interval: isWarp ? `${bestWarpInterval}s` : `${bestVLTRInterval}s`
    };

    config.outbounds.unshift(selector, urlTest);

    if (isWarp) {
        const secondUrlTest = structuredClone(urlTest);
        secondUrlTest.tag = `💦 WoW - Best Ping 🚀`;
        secondUrlTest.outbounds = secondUrlTestTags;
        config.outbounds.push(secondUrlTest);
    }

    return config;
}

export async function getSingBoxWarpConfig(request, env) {
    const { warpConfigs } = await getDataset(request, env);
    const warpTags = [], wowTags = [];
    const endpoints = {
        proxies: [],
        chains: []
    }

    warpEndpoints.forEach((endpoint, index) => {
        const warpTag = `💦 ${index + 1} - Warp 🇮🇷`;
        warpTags.push(warpTag);

        const wowTag = `💦 ${index + 1} - WoW 🌍`;
        wowTags.push(wowTag);

        const warpOutbound = buildSingBoxWarpOutbound(warpConfigs, warpTag, endpoint, '');
        endpoints.proxies.push(warpOutbound);

        const wowOutbound = buildSingBoxWarpOutbound(warpConfigs, wowTag, endpoint, warpTag);
        endpoints.chains.push(wowOutbound);
    });

    const selectorTags = [`💦 Warp - Best Ping 🚀`, `💦 WoW - Best Ping 🚀`, ...warpTags, ...wowTags];
    const config = await buildSingBoxConfig(selectorTags, warpTags, wowTags, true);
    config.endpoints = [...endpoints.chains, ...endpoints.proxies];

    return new Response(JSON.stringify(config, null, 4), {
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'CDN-Cache-Control': 'no-store'
        }
    });
}

export async function getSingBoxCustomConfig(env) {
    let chainProxy;
    if (outProxy) {
        try {
            chainProxy = buildSingBoxChainOutbound(outProxyParams, VLTRenableIPv6);
        } catch (error) {
            console.log('An error occured while parsing chain proxy: ', error);
            chainProxy = undefined;
            const proxySettings = await env.kv.get("proxySettings", { type: 'json' });
            await env.kv.put("proxySettings", JSON.stringify({
                ...proxySettings,
                outProxy: '',
                outProxyParams: {}
            }));
        }
    }

    let proxyIndex = 1;
    const protocols = [];
    VLConfigs && protocols.push('VLESS');
    TRConfigs && protocols.push('Trojan');
    const tags = [];
    const Addresses = await getConfigAddresses(cleanIPs, VLTRenableIPv6, customCdnAddrs);
    const outbounds = {
        proxies: [],
        chains: []
    }

    protocols.forEach(protocol => {
        let protocolIndex = 1;
        ports.forEach(port => {
            Addresses.forEach(addr => {
                let VLOutbound, TROutbound;
                const isCustomAddr = customCdnAddrs.includes(addr);
                const configType = isCustomAddr ? 'C' : '';
                const sni = isCustomAddr ? customCdnSni : randomUpperCase(hostName);
                const host = isCustomAddr ? customCdnHost : hostName;
                const tag = generateRemark(protocolIndex, port, addr, cleanIPs, protocol, configType);

                if (protocol === "VLESS") {
                    VLOutbound = buildSingBoxVLOutbound(
                        chainProxy ? `proxy-${proxyIndex}` : tag,
                        addr,
                        port,
                        host,
                        sni,
                        isCustomAddr
                    );

                    outbounds.proxies.push(VLOutbound);
                }

                if (protocol === "Trojan") {
                    TROutbound = buildSingBoxTROutbound(
                        chainProxy ? `proxy-${proxyIndex}` : tag,
                        addr,
                        port,
                        host,
                        sni,
                        isCustomAddr
                    );

                    outbounds.proxies.push(TROutbound);
                }

                if (chainProxy) {
                    const chain = structuredClone(chainProxy);
                    chain.tag = tag;
                    chain.detour = `proxy-${proxyIndex}`;
                    outbounds.chains.push(chain);
                }

                tags.push(tag);

                proxyIndex++;
                protocolIndex++;
            });
        });
    });

    const selectorTags = ['💦 Best Ping 💥', ...tags];
    const config = await buildSingBoxConfig(selectorTags, tags, null, false);
    config.outbounds.push(...outbounds.chains, ...outbounds.proxies);

    return new Response(JSON.stringify(config, null, 4), {
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'CDN-Cache-Control': 'no-store'
        }
    });
}

const singboxConfigTemp = {
    log: {
        level: "warn",
        timestamp: true
    },
    dns: {},
    inbounds: [
        {
            type: "direct",
            tag: "dns-in",
            listen: "0.0.0.0",
            listen_port: 6450,
            override_address: "1.1.1.1",
            override_port: 53
        },
        {
            type: "tun",
            tag: "tun-in",
            address: [
                "172.18.0.1/30",
                "fdfe:dcba:9876::1/126"
            ],
            mtu: 9000,
            auto_route: true,
            strict_route: true,
            endpoint_independent_nat: true,
            stack: "mixed"
        },
        {
            type: "mixed",
            tag: "mixed-in",
            listen: "0.0.0.0",
            listen_port: 2080
        }
    ],
    outbounds: [
        {
            type: "direct",
            // domain_resolver: {
            //     server: "dns-direct",
            //     strategy: "ipv4_only"
            // },
            tag: "direct"
        }
    ],
    route: {},
    ntp: {
        enabled: true,
        server: "time.apple.com",
        server_port: 123,
        detour: "direct",
        interval: "30m",
        write_to_system: false
    },
    experimental: {
        cache_file: {
            enabled: true,
            store_fakeip: true
        },
        clash_api: {
            external_controller: "127.0.0.1:9090",
            external_ui: "ui",
            external_ui_download_url: "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
            external_ui_download_detour: "direct",
            default_mode: "Rule"
        }
    }
};