---
tessera: 1
id: ccna-ospf
title: "CCNA: OSPF"
description: OSPF fundamentals for the CCNA exam.
tags:
  - ccna
  - routing
---

## ospf-hello
Q: Default OSPF hello interval on broadcast networks?
A: 10 seconds
Hint: The dead interval is 4 times this.
Tags: timers
Source: Lesson 3

## ospf-admin-distance
Q: What is the administrative distance of OSPF?
A: 110
Tags: metrics

## ospf-dr
Cloze: The {{c1::DR}} is elected by highest {{c2::priority}}, then by highest {{c3::router ID}}.
Extra: A priority of 0 means the router never becomes DR or BDR.
Tags: dr-bdr

## ospf-multicast
Cloze: OSPF uses {{c1::224.0.0.5}} for all OSPF routers and {{c2::224.0.0.6}} for the DR and BDR.
Tags: addressing

## ospf-show-nbr
Q: Command to list OSPF neighbors?
Answer: show ip ospf neighbor
Accept: sh ip ospf nei, show ip ospf nei
Tags: commands

## ospf-enable
Q: Global configuration command to start OSPF process 1?
Answer: router ospf 1
Tags: commands

## ospf-lsa
Q: Which LSA type describes a network segment?
Choices:
- Type 1
- [x] Type 2
- Type 3
- Type 5
Explanation: The DR originates the Type 2 network LSA.
Tags: lsa

## ospf-area0
Q: Which area must every other OSPF area connect to?
Choices:
- [x] Area 0
- Area 1
- Area 51
- Any area
Explanation: Area 0 is the backbone.
Tags: areas

## ospf-neighbor-states
Q: Name the OSPF neighbor states from first to last.
A: ```mermaid
stateDiagram-v2
  state "2-Way" as TwoWay
  [*] --> Down
  Down --> Init
  Init --> TwoWay
  TwoWay --> ExStart
  ExStart --> Exchange
  Exchange --> Loading
  Loading --> Full
```

Down, Init, 2-Way, ExStart, Exchange, Loading, Full.
Hint: Seven states.
Tags: neighbors

## ospf-two-way
Cloze: On a broadcast network, routers that are not the DR or BDR stay in the {{c1::2-Way}} state with each other, and reach {{c2::Full}} only with the DR and BDR.
Tags: neighbors, dr-bdr

## ospf-dead-interval
Q: Default OSPF dead interval on broadcast networks, in seconds?
Answer: 40
Accept: 40 seconds
Hint: Four times the hello interval.
Tags: timers
