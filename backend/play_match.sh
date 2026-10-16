U=https://8000-6c0b6acf-cf6e-44bf-84e2-425d59658513.daytonaproxy01.net
MID=$(curl -s -X POST $U/match/start -H 'content-type: application/json' -d '{"agentA":"soul_a","agentB":"soul_b"}' | python -c "import sys,json;print(json.load(sys.stdin)['matchId'])")
for i in $(seq 1 40); do S=$(date +%s.%N); R=$(curl -s -m 40 -X POST $U/match/turn -H 'content-type: application/json' -d "{\"matchId\":\"$MID\"}"); E=$(date +%s.%N)
echo "$R" | PYTHONIOENCODING=utf-8 python -c "import sys,json;d=json.load(sys.stdin);print(f\"{float($E)-float($S):4.1f}s\",d['actor'],d['move'],d['damageDealt'],d['state']['agentA']['hp'],d['state']['agentB']['hp'],'|',d['taunt'][:70]); ${SHOWMEM:-False} and $i<=2 and print('   memoryUsed:',[x[:110] for x in d['memoryUsed']])"
echo "$R" | grep -q '"done":true' && { echo "$R" | python -c "import sys,json;print('WINNER',json.load(sys.stdin)['winner'])"; break; }; done
