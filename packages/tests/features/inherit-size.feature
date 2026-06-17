Feature: New terminal inherits active terminal's size
  When a new terminal is created, it inherits the width and height of the
  currently active terminal — not the default size, and not the last-created
  terminal's size. This guards against the `resolveReferenceLayout` bug that
  walked tileIds backwards and picked the "last" terminal instead of the
  "active" one.

  Background:
    Given the terminal is ready

  Scenario: New terminal inherits active terminal's size, not last terminal's
    # Create A, B. Resize A to non-default. Focus A. Create C.
    # C must have A's size (the active tile), not B's (the last-created tile).
    # This proves inheritance flows from the ACTIVE terminal.
    Given I create a terminal
    And I create a terminal
    When I resize canvas tile 1 to width 1000 and height 700
    And I click canvas tile 1
    And I create a terminal
    Then there should be 3 canvas tiles
    And canvas tile 3 should have width 1000 and height 700
    And there should be no page errors

  Scenario: First terminal uses default size
    # With no prior terminal to inherit from, the first tile uses defaults.
    Then there should be 1 canvas tile
    And canvas tile 1 should have width 800 and height 540
    And there should be no page errors

  Scenario: Successive creates chain the inherited size
    # Create A (default), create B (inherits A's default), resize B,
    # create C (inherits B's resized size). Proves the bridge carries
    # size across the active-tile chain, not just the first create.
    Given I create a terminal
    When I resize the active canvas tile to width 1100 and height 600
    And I create a terminal
    Then canvas tile 2 should have width 1100 and height 600
    And there should be no page errors
